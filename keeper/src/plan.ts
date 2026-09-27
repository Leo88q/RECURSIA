/**
 * Keeper planner — PURE function from an on-chain snapshot to a list of crank
 * actions. No I/O, fully unit-testable. The executor (main.ts) turns actions
 * into transactions, simulates each one and only then signs.
 *
 * Every action here is permissionless on-chain; the program re-validates all
 * conditions, so a stale snapshot can only cause a failed simulation, never a
 * wrong state transition (checklist #17 race conditions, #28 keeper trust).
 */
import { Buffer } from "buffer";
import type { PublicKey } from "@solana/web3.js";
import {
  BREACH_RESONANCE, harbergerDue, oraoRandomnessPda, QUANTUM_BOUNTY_DIV,
  type ConfigAccount, type OraoState, type SeasonAccount, type TournamentAccount, type SuperpositionAccount, type SwapAccount, type TerritoryAccount, type WorldAccount,
} from "@recursia/sdk";

export interface Snapshot {
  slot: bigint;
  config: ConfigAccount;
  worlds: { key: PublicKey; acc: WorldAccount }[];
  territories: { key: PublicKey; acc: TerritoryAccount }[];
  superpositions?: { key: PublicKey; acc: SuperpositionAccount }[];
  swaps?: { key: PublicKey; acc: SwapAccount }[];
  season?: SeasonAccount;
  tournaments?: { key: PublicKey; acc: TournamentAccount }[];
  /** ORAO VRF request state per seed (hex) for measurable superpositions / accepted SWAPs. */
  vrf?: Map<string, OraoState["state"]>;
  /** ORAO treasury (from its NetworkState) — needed to create requests. */
  oraoTreasury?: PublicKey;
}

export type Action =
  | { kind: "advance_epoch" }
  | { kind: "claim_world_epoch"; world: PublicKey }
  | { kind: "claim_season_prize"; winner: PublicKey; rank: number }
  | { kind: "tournament_settle"; seasonId: bigint; tier: number }
  | { kind: "claim_tournament_prize"; winner: PublicKey; seasonId: bigint; tier: number; rank: number }
  | { kind: "settle"; world: PublicKey; index: number; holder: PublicKey }
  | { kind: "breach"; child: PublicKey; host: PublicKey }
  | { kind: "tick"; world: PublicKey; module: PublicKey; host: PublicKey | null }
  | { kind: "vrf_request"; seed: Uint8Array; treasury: PublicKey }
  | { kind: "quantum_observe"; world: PublicKey; index: number; vrf: PublicKey }
  | { kind: "quantum_decohere"; world: PublicKey; index: number; owner: PublicKey }
  | { kind: "swap_resolve"; world: PublicKey; a: number; b: number; offerer: PublicKey; acceptor: PublicKey; vrf: PublicKey }
  | { kind: "swap_cancel"; world: PublicKey; a: number; b: number; offerer: PublicKey };

export interface PlanLimits {
  /** Max tick transactions per round (each costs a signature fee). */
  maxTicks: number;
  /** Max settle transactions per round. */
  maxSettles: number;
  /** Skip worlds whose energy covers fewer than this many ticks (dust worlds). */
  minTicksOfEnergy: bigint;
  /** Max observe/decohere transactions per round. */
  maxQuantum: number;
}
export const DEFAULT_LIMITS: PlanLimits = { maxTicks: 24, maxSettles: 16, minTicksOfEnergy: 1n, maxQuantum: 16 };

export const seedHex = (seed: Uint8Array) => Buffer.from(seed).toString("hex");

/**
 * Quantum measurements. `observe` is allowed even while paused (settlement,
 * like withdrawals); `decohere` only when unpaused. Earliest target first.
 * VRF liveness: if nobody has asked ORAO for a measurable seed yet, the keeper
 * asks (the answer depends only on the seed); once fulfilled it measures.
 */
export function planQuantum(s: Snapshot, limits: PlanLimits = DEFAULT_LIMITS): Action[] {
  const out: Action[] = [];
  const vrfStep = (seed: Uint8Array, measure: (vrf: PublicKey) => Action) => {
    const st = s.vrf?.get(seedHex(seed)) ?? "missing";
    if (st === "fulfilled") out.push(measure(oraoRandomnessPda(seed)));
    else if (st === "missing" && s.oraoTreasury) out.push({ kind: "vrf_request", seed, treasury: s.oraoTreasury });
    // "pending": ORAO is answering; "invalid": someone squatted nothing — PDA is fixed, just wait
  };
  const sps = [...(s.superpositions ?? [])].sort((a, b) => (a.acc.targetSlot < b.acc.targetSlot ? -1 : 1));
  for (const { acc } of sps) {
    if (out.length >= limits.maxQuantum) break;
    if (acc.stake / QUANTUM_BOUNTY_DIV === 0n) continue; // nothing to earn, let the owner do it
    if (!acc.observed && s.slot > acc.targetSlot) {
      // while unobserved, `entropy` holds the VRF seed fixed at commit
      vrfStep(acc.entropy, (vrf) => ({ kind: "quantum_observe", world: acc.world, index: acc.index, vrf }));
    } else if (acc.observed && s.slot > acc.revealDeadline && !s.config.paused) {
      out.push({ kind: "quantum_decohere", world: acc.world, index: acc.index, owner: acc.owner });
    }
  }
  // SWAP settlement (neutral worlds): resolve works while paused, cancel of an
  // expired offer only returns funds so it is allowed while paused as well.
  const swaps = [...(s.swaps ?? [])].sort((x, y) => (x.acc.targetSlot < y.acc.targetSlot ? -1 : 1));
  for (const { acc } of swaps) {
    if (out.length >= limits.maxQuantum) break;
    if (acc.bounty === 0n) continue;
    if (acc.accepted && s.slot > acc.targetSlot) {
      vrfStep(acc.vrfSeed, (vrf) => ({ kind: "swap_resolve", world: acc.world, a: acc.indexA, b: acc.indexB, offerer: acc.offerer, acceptor: acc.acceptor, vrf }));
    } else if (!acc.accepted && s.slot > acc.expirySlot) {
      out.push({ kind: "swap_cancel", world: acc.world, a: acc.indexA, b: acc.indexB, offerer: acc.offerer });
    }
  }
  return out;
}

const isDefault = (k: PublicKey) => k.toBytes().every((b) => b === 0);

/** Can this world's epoch window be claimed right now (mirrors roll_world_epoch + claim checks)? */
export function claimable(w: WorldAccount, curEpoch: bigint): boolean {
  if (w.epochId + 1n === curEpoch) return w.sinkCur > 0n; // will roll into prev on-chain
  if (w.epochId === curEpoch) return w.prevEpochId + 1n === curEpoch && !w.prevClaimed && w.sinkPrev > 0n;
  return false; // skipped ≥1 epoch: window is forfeited
}

/** Unclaimed, non-zero prizes of the last closed season (bit r of lastClaimed = rank r paid). */
export function seasonPrizes(season: SeasonAccount | undefined): Action[] {
  if (!season) return [];
  const out: Action[] = [];
  season.lastTop.forEach((e, rank) => {
    if (isDefault(e.player) || season.lastPrizes[rank] === 0n || (season.lastClaimed & (1 << rank)) !== 0) return;
    out.push({ kind: "claim_season_prize", winner: e.player, rank });
  });
  return out;
}

/** Tournaments of closed seasons: settle once, then credit every unclaimed prize to its winner. */
export function tournamentActions(tournaments: Snapshot["tournaments"], seasonId: bigint): Action[] {
  const out: Action[] = [];
  for (const { acc: t } of tournaments ?? []) {
    if (t.seasonId >= seasonId) continue;
    if (!t.settled) { if (t.pot > 0n) out.push({ kind: "tournament_settle", seasonId: t.seasonId, tier: t.tier }); continue; }
    t.top.forEach((e, rank) => {
      if (isDefault(e.player) || t.prizes[rank] === 0n || (t.claimed & (1 << rank)) !== 0) return;
      out.push({ kind: "claim_tournament_prize", winner: e.player, seasonId: t.seasonId, tier: t.tier, rank });
    });
  }
  return out;
}

export function plan(s: Snapshot, limits: PlanLimits = DEFAULT_LIMITS): Action[] {
  const out: Action[] = [];
  const c = s.config;
  if (c.paused) return planQuantum(s, limits); // only settlement is crankable while paused

  const p = c.params;
  let curEpoch = c.curEpoch;
  if (s.slot >= c.epochStartSlot + p.epochSlots) {
    out.push({ kind: "advance_epoch" });
    curEpoch += 1n; // claims below are ordered after the advance in the same round
  }

  const byKey = new Map(s.worlds.map((w) => [w.key.toBase58(), w]));

  // 1. emission claims (every world, cheap, benefits all holders)
  for (const w of s.worlds) if (claimable(w.acc, curEpoch)) out.push({ kind: "claim_world_epoch", world: w.key });

  // 1b. season prizes of the last closed season (permissionless; credited to the winner, not to us)
  out.push(...seasonPrizes(s.season));
  out.push(...tournamentActions(s.tournaments, c.seasonId));

  // 2. foreclosures — keep the Harberger market honest
  const settles: Action[] = [];
  for (const t of s.territories) {
    const a = t.acc;
    if (isDefault(a.holder)) continue;
    const due = harbergerDue(a.price, p.harbergerBps, s.slot > a.lastTaxSlot ? s.slot - a.lastTaxSlot : 0n, p.epochSlots);
    if (due >= a.deposit) settles.push({ kind: "settle", world: a.world, index: a.index, holder: a.holder });
  }
  out.push(...settles.slice(0, limits.maxSettles));

  // 3. breaches (child life leaking into the host world)
  for (const w of s.worlds) {
    if (w.acc.depth === 0 || w.acc.resonance < BREACH_RESONANCE) continue;
    if (byKey.has(w.acc.parent.toBase58())) out.push({ kind: "breach", child: w.key, host: w.acc.parent });
  }

  // 4. ticks — oldest first so no world starves (fair ordering, DoS resistant)
  const due = s.worlds
    .filter(({ acc }) => {
      if (s.slot < acc.lastTickSlot + p.tickIntervalSlots) return false;
      if (acc.energy < p.tickCost * limits.minTicksOfEnergy) return false;
      if (acc.depth > 0) {
        const host = byKey.get(acc.parent.toBase58());
        if (!host || host.acc.territoryAlive[acc.parentTerritory] === 0) return false; // dormant
      }
      return true;
    })
    .sort((a, b) => (a.acc.lastTickSlot < b.acc.lastTickSlot ? -1 : a.acc.lastTickSlot > b.acc.lastTickSlot ? 1 : 0))
    .slice(0, limits.maxTicks);
  for (const w of due) out.push({ kind: "tick", world: w.key, module: w.acc.module, host: w.acc.depth > 0 ? w.acc.parent : null });

  // 5. quantum measurements (bounty = stake / 20)
  out.push(...planQuantum(s, limits));
  return out;
}

/** Expected cranker income for a round of ticks, in base units. */
export const crankIncome = (actions: Action[], cfg: ConfigAccount) =>
  BigInt(actions.filter((a) => a.kind === "tick").length) * ((cfg.params.tickCost * BigInt(cfg.params.crankerBps)) / 10_000n);
