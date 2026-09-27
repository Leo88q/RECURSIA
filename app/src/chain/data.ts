// Live on-chain state. Websocket subscriptions for what changes often
// (worlds, your accounts) + low-frequency polling as a fallback for RPCs whose
// websockets are flaky. Territories/superpositions of the open world are
// fetched as 2 batched getMultipleAccountsInfo calls (works on every RPC,
// unlike heavy getProgramAccounts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MINT } from "./mint";
import type { AccountInfo, Connection, GetProgramAccountsFilter, PublicKey as PK } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  accountDiscriminator, ata, decodeConfig, decodeSeason, type SeasonAccount, decodeTournament, type TournamentAccount, decodeModule, decodePermit, decodePlayer, decodeSuperposition, decodeSwap, decodeTerritory, decodeWorld,
  Pdas, TERRITORIES, type ConfigAccount, type ModuleAccount, type PermitAccount, type PlayerAccount, type SuperpositionAccount, type SwapAccount,
  type TerritoryAccount, type WorldAccount,
} from "@recursia/sdk";
import { readTokenAmount } from "../lib/txmath";
import { useVisible } from "../lib/visible";
export { useVisible };

export interface Keyed<T> { key: PublicKey; acc: T }

const disc = (name: string): GetProgramAccountsFilter => ({ memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator(name)) } });
const safe = <T,>(f: () => T): T | null => { try { return f(); } catch { return null; } };
const owned = (info: AccountInfo<Uint8Array> | null, programId: PK) => !!info && info.owner.equals(programId);

// Offsets (8-byte discriminator first) — see packages/sdk/src/layout.ts.
const TERRITORY_HOLDER_OFFSET = 8 + 1 + 1 + 32 + 1;
const PERMIT_OWNER_OFFSET = 8 + 3;
/** TournamentEntry: disc 8 + version 1 + bump 1 + tournament 32 → owner */
const ENTRY_OWNER_OFFSET = 8 + 1 + 1 + 32;

function usePoll(fn: () => void, ms: number, deps: unknown[]) {
  const visible = useVisible();
  useEffect(() => {
    if (!visible) return;
    fn();
    const i = setInterval(fn, ms);
    return () => clearInterval(i);
  }, [visible, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface ProgramData {
  config: ConfigAccount | null | undefined;
  worlds: Array<Keyed<WorldAccount>>;
  modules: Array<Keyed<ModuleAccount>>;
  swaps: Array<Keyed<SwapAccount>>;
  /** Season leaderboard + last season's prizes (null until loaded / on old deployments). */
  season: SeasonAccount | null;
  /** Season tournaments (all tiers, recent seasons). */
  tournaments: Array<Keyed<TournamentAccount>>;
  /** Token balances of the sponsor and season pools (null = unknown). */
  pools: { sponsor: bigint | null; season: bigint | null };
  slot: number;
  error: string | null;
  /** Bumped on every live update of a world (key → counter). */
  worldVersion: Map<string, number>;
  refresh: () => void;
}

export function useProgramData(connection: Connection, programId: PublicKey): ProgramData {
  const pda = useRef(new Pdas(programId)).current;
  const [config, setConfig] = useState<ConfigAccount | null | undefined>(undefined);
  const [worlds, setWorlds] = useState<Map<string, WorldAccount>>(new Map());
  const [modules, setModules] = useState<Array<Keyed<ModuleAccount>>>([]);
  const [swaps, setSwaps] = useState<Array<Keyed<SwapAccount>>>([]);
  const [season, setSeason] = useState<SeasonAccount | null>(null);
  const [tournaments, setTournaments] = useState<Array<Keyed<TournamentAccount>>>([]);
  const [pools, setPools] = useState<{ sponsor: bigint | null; season: bigint | null }>({ sponsor: null, season: null });
  const [slot, setSlot] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [worldVersion, setWorldVersion] = useState<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const bump = (k: string) => setWorldVersion((m) => new Map(m).set(k, (m.get(k) ?? 0) + 1));

  // Config + worlds: full reload (slow poll) …
  const loadCore = useCallback(async () => {
    try {
      const info = await connection.getAccountInfo(pda.config(), "confirmed");
      if (!owned(info, programId)) { setConfig(null); return; }
      setConfig(safe(() => decodeConfig(info!.data)));
      const res = await connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("World")] });
      const m = new Map<string, WorldAccount>();
      for (const r of res) { const w = safe(() => decodeWorld(r.account.data)); if (w) m.set(r.pubkey.toBase58(), w); }
      setWorlds(m);
      setError(null);
    } catch (e) { setError((e as Error).message); setConfig((c) => (c === undefined ? null : c)); }
  }, [connection, programId, pda]);
  usePoll(loadCore, 45_000, [loadCore, tick]);

  const loadExtra = useCallback(async () => {
    try {
      const [mods, sws] = await Promise.all([
        connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("PhysicsModule")] }),
        connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("QuantumSwap")] }),
      ]);
      const [si, sp, ssp] = await connection.getMultipleAccountsInfo([pda.season(), pda.sponsorPool(), pda.seasonPool()], "confirmed").catch(() => [null, null, null]);
      setSeason(owned(si, programId) ? safe(() => decodeSeason(si!.data)) : null);
      const ts = await connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("Tournament")] }).catch(() => []);
      setTournaments(ts.flatMap((r) => { const acc = safe(() => decodeTournament(r.account.data)); return acc ? [{ key: r.pubkey, acc }] : []; })
        .sort((a, b) => Number(a.acc.seasonId - b.acc.seasonId) || a.acc.tier - b.acc.tier));
      setPools({ sponsor: sp ? readTokenAmount(sp.data) : null, season: ssp ? readTokenAmount(ssp.data) : null });
      setModules(mods.flatMap((r) => { const acc = safe(() => decodeModule(r.account.data)); return acc ? [{ key: r.pubkey, acc }] : []; }).sort((a, b) => Number(a.acc.id - b.acc.id)));
      setSwaps(sws.flatMap((r) => { const acc = safe(() => decodeSwap(r.account.data)); return acc ? [{ key: r.pubkey, acc }] : []; }));
    } catch { /* optional data */ }
  }, [connection, programId, pda]);
  usePoll(loadExtra, 20_000, [loadExtra, tick]);

  usePoll(() => { connection.getSlot("confirmed").then(setSlot).catch(() => {}); }, 4_000, [connection]);

  // … plus live websocket updates.
  useEffect(() => {
    if (!config) return;
    const offs: Array<() => void> = [];
    const acc = (id: number) => offs.push(() => { connection.removeAccountChangeListener(id).catch(() => {}); });
    const prog = (id: number) => offs.push(() => { connection.removeProgramAccountChangeListener(id).catch(() => {}); });
    try {
      acc(connection.onAccountChange(pda.config(), (info) => { const c = safe(() => decodeConfig(info.data)); if (c) setConfig(c); }, { commitment: "confirmed" }));
      prog(connection.onProgramAccountChange(programId, (ka) => {
        const w = safe(() => decodeWorld(ka.accountInfo.data));
        if (!w) return;
        const k = ka.accountId.toBase58();
        setWorlds((m) => new Map(m).set(k, w));
        bump(k);
      }, { commitment: "confirmed", filters: [disc("World")] }));
      prog(connection.onProgramAccountChange(programId, () => loadExtra(), { commitment: "confirmed", filters: [disc("QuantumSwap")] }));
    } catch { /* ws unsupported: polling covers it */ }
    return () => { for (const off of offs) off(); };
  }, [connection, programId, pda, !!config]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => [...worlds.entries()].map(([k, acc]) => ({ key: new PublicKey(k), acc }))
    .sort((a, b) => a.acc.depth - b.acc.depth || Number(a.acc.index - b.acc.index) || a.key.toBase58().localeCompare(b.key.toBase58())), [worlds]);
  return useMemo(() => ({ config, worlds: list, modules, swaps, season, tournaments, pools, slot, error, worldVersion, refresh }), [config, list, modules, swaps, season, tournaments, pools, slot, error, worldVersion, refresh]);
}

export interface WorldDetail { territories: Map<number, TerritoryAccount>; superpositions: Map<number, SuperpositionAccount>; loading: boolean }

/** Keyed by the base58 string (stable identity) — a PublicKey object would change every render and re-trigger loads. */
export function useWorldDetail(connection: Connection, programId: PublicKey, worldKey: string | null, version: number): WorldDetail {
  const pda = useRef(new Pdas(programId)).current;
  const [d, setD] = useState<WorldDetail>({ territories: new Map(), superpositions: new Map(), loading: true });
  const key = worldKey ?? "";
  const timer = useRef<number>(0);
  const current = useRef(key); current.current = key;
  const load = useCallback(async () => {
    if (!key) return;
    const world = new PublicKey(key);
    const tKeys = Array.from({ length: TERRITORIES }, (_, i) => pda.territory(world, i));
    const sKeys = Array.from({ length: TERRITORIES }, (_, i) => pda.superposition(world, i));
    try {
      const [ts, ss] = await Promise.all([connection.getMultipleAccountsInfo(tKeys, "confirmed"), connection.getMultipleAccountsInfo(sKeys, "confirmed")]);
      const territories = new Map<number, TerritoryAccount>();
      ts.forEach((info, i) => { if (owned(info, programId)) { const t = safe(() => decodeTerritory(info!.data)); if (t) territories.set(i, t); } });
      const superpositions = new Map<number, SuperpositionAccount>();
      ss.forEach((info, i) => { if (owned(info, programId)) { const s = safe(() => decodeSuperposition(info!.data)); if (s) superpositions.set(i, s); } });
      if (current.current === key) setD({ territories, superpositions, loading: false }); // drop stale responses after switching worlds
    } catch { if (current.current === key) setD((p) => ({ ...p, loading: false })); }
  }, [connection, programId, pda, key]);
  useEffect(() => { setD({ territories: new Map(), superpositions: new Map(), loading: true }); }, [key]);
  // debounce: a busy world changes every few hundred ms
  useEffect(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(load, version === 0 ? 0 : 700); return () => window.clearTimeout(timer.current); }, [load, version]);
  usePoll(load, 30_000, [load]);
  return d;
}

export interface MyData {
  sol: number | null;
  /** null = no SKR token account yet */
  rcr: bigint | null;
  player: PlayerAccount | null;
  permits: Array<Keyed<PermitAccount>>;
  holdings: Array<Keyed<TerritoryAccount>>;
  /** permit pubkey → SKR in its vault */
  permitVaults: Map<string, bigint>;
  /** tournaments (pubkey base58) this wallet has entered */
  tournamentEntries: Set<string>;
  refresh: () => void;
}

export function useMyData(connection: Connection, programId: PublicKey, owner: PublicKey | null): MyData {
  const pda = useRef(new Pdas(programId)).current;
  const [d, setD] = useState<Omit<MyData, "refresh">>({ sol: null, rcr: null, player: null, permits: [], holdings: [], permitVaults: new Map(), tournamentEntries: new Set() });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const ownerKey = owner?.toBase58();
  const load = useCallback(async () => {
    if (!owner) { setD({ sol: null, rcr: null, player: null, permits: [], holdings: [], permitVaults: new Map(), tournamentEntries: new Set() }); return; }
    try {
      const [infos, permits, holdings, entries] = await Promise.all([
        connection.getMultipleAccountsInfo([owner, ata(owner, MINT), pda.player(owner)], "confirmed"),
        connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("AgentPermit"), { memcmp: { offset: PERMIT_OWNER_OFFSET, bytes: owner.toBase58() } }] }).catch(() => []),
        connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("Territory"), { memcmp: { offset: TERRITORY_HOLDER_OFFSET, bytes: owner.toBase58() } }] }).catch(() => []),
        connection.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("TournamentEntry"), { memcmp: { offset: ENTRY_OWNER_OFFSET, bytes: owner.toBase58() } }] }).catch(() => []),
      ]);
      const permitList = permits.flatMap((r) => { const acc = safe(() => decodePermit(r.account.data)); return acc ? [{ key: r.pubkey, acc }] : []; });
      const vaultInfos = permitList.length ? await connection.getMultipleAccountsInfo(permitList.map((p) => pda.permitVault(p.key)), "confirmed").catch(() => []) : [];
      const permitVaults = new Map<string, bigint>();
      permitList.forEach((p, i) => permitVaults.set(p.key.toBase58(), readTokenAmount(vaultInfos[i]?.data) ?? 0n));
      setD({
        permitVaults,
        sol: infos[0]?.lamports ?? 0,
        rcr: infos[1] ? readTokenAmount(infos[1].data) : null,
        player: owned(infos[2], programId) ? safe(() => decodePlayer(infos[2]!.data)) : null,
        permits: permitList,
        tournamentEntries: new Set(entries.map((r) => new PublicKey(r.account.data.subarray(10, 42)).toBase58())),
        holdings: holdings.flatMap((r) => { const acc = safe(() => decodeTerritory(r.account.data)); return acc ? [{ key: r.pubkey, acc }] : []; }),
      });
    } catch { /* keep last good state */ }
  }, [connection, programId, pda, ownerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(load, 30_000, [load, tick]);
  useEffect(() => {
    if (!owner) return;
    const subs = [owner, ata(owner, MINT), pda.player(owner)].map((k) => connection.onAccountChange(k, () => load(), { commitment: "confirmed" }));
    return () => { for (const s of subs) connection.removeAccountChangeListener(s).catch(() => {}); };
  }, [connection, ownerKey, load]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...d, refresh };
}
