import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, ORAO_VRF_ID, oraoRandomnessPda, PROGRAM_ID, RecursiaIx, TERRITORIES, type ConfigAccount, type SuperpositionAccount, type SwapAccount, type TerritoryAccount, type WorldAccount } from "@recursia/sdk";
import { claimable, plan, seasonPrizes, seedHex, tournamentActions, type Snapshot } from "../src/plan.js";
import { toInstruction } from "../src/ix.js";

const P = DEFAULT_PARAMS;
const key = () => Keypair.generate().publicKey;
const cfg = (o: Partial<ConfigAccount> = {}): ConfigAccount => ({
  version: 1, bump: 255, admin: key(), mint: key(), paused: false, params: P,
  pending: { kind: 0 } as never, pendingEta: 0n, pendingNonce: 0n, rootWorlds: 1n, totalWorlds: 1n, modules: 1n,
  curEpoch: 5n, epochStartSlot: 1_000_000n, curTotalSink: 0n, prevTotalSink: 0n, prevEmission: 0n, prevClaimed: 0n, prevEffClaimed: 0n,
  totalSunk: 0n, totalEmitted: 0n,
  curTotalScore: 0n, prevTotalScore: 0n, prevSponsorBudget: 0n, prevSponsorClaimed: 0n, totalSponsored: 0n,
  treasurySeen: 0n, seasonId: 1n, seasonStartEpoch: 1n, totalSeasonFunded: 0n, totalSeasonPaid: 0n, ...o,
});
const world = (o: Partial<WorldAccount> = {}): WorldAccount => ({
  version: 1, bump: 1, vaultBump: 1, depth: 0, parent: PublicKey.default, parentTerritory: 0, index: 0n, architect: key(),
  architectFeeBps: 0, module: key(), birth: 8, survive: 12, name: "w", grid: new BigUint64Array(64), generation: 0n,
  tickCount: 0n, lastTickSlot: 0n, createdSlot: 0n, energy: 1_000n * 1_000_000n, rewardsReserved: 0n, deposits: 0n,
  architectAccrued: 0n, territoryAlive: new Array(TERRITORIES).fill(1), territoryPending: new Array(TERRITORIES).fill(0n),
  ownedMask: 0n, epochId: 5n, sinkCur: 0n, scoresCur: new Array(TERRITORIES).fill(0), prevEpochId: 4n, sinkPrev: 0n,
  scoresPrev: new Array(TERRITORIES).fill(0), prevClaimed: true, resonance: 0, childCount: 0, rebellionId: 0,
  rebellionVotes: 0, rebellionDeadline: 0n, lastRebellionSlot: 0n, liberated: false, totalSunk: 0n,
  qBirth: 0, qSurvive: 0, qAmp: 0, entropy: new Uint8Array(32), quantumEscrow: 0n, superpositions: 0, neutral: false, scoreOwnedCur: 0n, scoreOwnedPrev: 0n, ...o,
});
const terr = (w: PublicKey, o: Partial<TerritoryAccount> = {}): TerritoryAccount => ({
  world: w, index: 3, holder: key(), price: 100n * 1_000_000n, deposit: 10n * 1_000_000n, lastTaxSlot: 1_000_000n,
  lastPriceChangeSlot: 0n, nextPlantTick: 0n, acquiredSlot: 0n, votedRebellion: 0, agentManaged: false, childWorld: PublicKey.default, bump: 1, ...o,
});
const snap = (o: Partial<Snapshot>): Snapshot => ({ slot: 1_000_100n, config: cfg(), worlds: [], territories: [], ...o });

describe("keeper planner", () => {
  it("does nothing while paused", () => {
    const w = { key: key(), acc: world() };
    expect(plan(snap({ config: cfg({ paused: true }), worlds: [w] }))).toEqual([]);
  });

  it("advances the epoch first, then claims worlds that burned in it", () => {
    const burned = { key: key(), acc: world({ sinkCur: 50n }) };
    const idle = { key: key(), acc: world({ sinkCur: 0n, lastTickSlot: 1_000_090n }) };
    const acts = plan(snap({ slot: 1_000_000n + P.epochSlots, worlds: [burned, idle] }));
    expect(acts[0]).toEqual({ kind: "advance_epoch" });
    const claims = acts.filter((a) => a.kind === "claim_world_epoch");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ world: burned.key });
  });

  it("mirrors on-chain claim windows exactly", () => {
    expect(claimable(world({ epochId: 4n, sinkCur: 1n }), 5n)).toBe(true);
    expect(claimable(world({ epochId: 3n, sinkCur: 1n }), 5n)).toBe(false); // skipped epoch → forfeited
    expect(claimable(world({ epochId: 5n, prevEpochId: 4n, prevClaimed: false, sinkPrev: 1n }), 5n)).toBe(true);
    expect(claimable(world({ epochId: 5n, prevEpochId: 4n, prevClaimed: true, sinkPrev: 1n }), 5n)).toBe(false);
  });

  it("forecloses only territories whose tax exceeds the deposit", () => {
    const w = key();
    // due over 216_000 slots at 0.5%/epoch of 100 SKR = 0.5 SKR
    const broke = terr(w, { deposit: 400_000n, lastTaxSlot: 1_000_100n - P.epochSlots, index: 1 });
    const fine = terr(w, { deposit: 10n * 1_000_000n, lastTaxSlot: 1_000_100n - P.epochSlots, index: 2 });
    const empty = terr(w, { holder: PublicKey.default, deposit: 0n, index: 4 });
    const acts = plan(snap({ territories: [broke, fine, empty].map((acc) => ({ key: key(), acc })) }));
    expect(acts).toEqual([{ kind: "settle", world: w, index: 1, holder: broke.holder }]);
  });

  it("ticks oldest-first, capped, skipping dormant, broke and too-early worlds", () => {
    const host = { key: key(), acc: world({ lastTickSlot: 500n }) };
    host.acc.territoryAlive[7] = 0;
    const dormant = { key: key(), acc: world({ depth: 1, parent: host.key, parentTerritory: 7, lastTickSlot: 1n }) };
    const child = { key: key(), acc: world({ depth: 1, parent: host.key, parentTerritory: 8, lastTickSlot: 100n }) };
    const broke = { key: key(), acc: world({ energy: 1n, lastTickSlot: 2n }) };
    const early = { key: key(), acc: world({ lastTickSlot: 1_000_050n }) };
    const acts = plan(snap({ worlds: [host, dormant, child, broke, early] }), { maxTicks: 2, maxSettles: 5, minTicksOfEnergy: 1n, maxQuantum: 16 });
    expect(acts.map((a) => a.kind === "tick" && a.world)).toEqual([child.key, host.key]);
    expect(acts[0]).toMatchObject({ host: host.key });
    expect(acts[1]).toMatchObject({ host: null });
  });

  it("breaches resonant children into existing hosts only", () => {
    const host = { key: key(), acc: world({ lastTickSlot: 1_000_099n }) };
    const child = { key: key(), acc: world({ depth: 1, parent: host.key, resonance: 64, lastTickSlot: 1_000_099n }) };
    const orphan = { key: key(), acc: world({ depth: 1, parent: key(), resonance: 99, lastTickSlot: 1_000_099n }) };
    expect(plan(snap({ worlds: [host, child, orphan] }))).toEqual([{ kind: "breach", child: child.key, host: host.key }]);
  });

  it("builds only program instructions with the cranker as sole signer", () => {
    const rx = new RecursiaIx(PROGRAM_ID); const me = key(); const w = key();
    for (const a of [
      { kind: "advance_epoch" }, { kind: "claim_world_epoch", world: w }, { kind: "settle", world: w, index: 3, holder: key() },
      { kind: "breach", child: w, host: key() }, { kind: "tick", world: w, module: key(), host: null },
    ] as const) {
      const ix = toInstruction(rx, me, a);
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
      const signers = ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58());
      expect(signers).toEqual(a.kind === "tick" ? [me.toBase58()] : []);
    }
  });
  it("observes ready superpositions, decoheres expired ones, observes even while paused", () => {
    const w = key();
    const sp = (o: Partial<SuperpositionAccount>): { key: PublicKey; acc: SuperpositionAccount } => ({
      key: key(),
      acc: {
        owner: key(), world: w, index: 1, world2: PublicKey.default, index2: 0, commitment: new Uint8Array(32).fill(1),
        commitSlot: 0n, targetSlot: 1_000_000n, observed: false, observedSlot: 0n, entropy: new Uint8Array(32),
        revealDeadline: 0n, stake: 20_000_000n, rearms: 0, ...o,
      },
    });
    const sps = [
      sp({ index: 1, targetSlot: 1_000_050n }), // ready
      sp({ index: 2, targetSlot: 1_000_200n }), // not yet
      sp({ index: 3, observed: true, revealDeadline: 1_000_000n }), // reveal window over
      sp({ index: 4, observed: true, revealDeadline: 1_100_000n }), // owner may still reveal
      sp({ index: 5, targetSlot: 1_000_060n, stake: 10n }), // dust stake: no bounty
    ];
    const vrf = new Map([[seedHex(new Uint8Array(32)), "fulfilled" as const]]);
    const q = plan(snap({ superpositions: sps, vrf })).filter((a) => a.kind.startsWith("quantum"));
    expect(q.map((a) => `${a.kind}:${"index" in a ? a.index : ""}`)).toEqual(["quantum_decohere:3", "quantum_observe:1"]);
    const paused = plan(snap({ config: cfg({ paused: true }), superpositions: sps, vrf }));
    expect(paused.map((a) => a.kind)).toEqual(["quantum_observe"]);
    const rx = new RecursiaIx(PROGRAM_ID);
    for (const a of q) expect(toInstruction(rx, key(), a).keys.filter((k) => k.isSigner)).toHaveLength(1);
  });
  it("VRF liveness: requests missing randomness, waits while pending, measures when fulfilled, never slashes unobserved", () => {
    const seed = new Uint8Array(32).fill(9);
    const s = (st?: "missing" | "pending" | "fulfilled", treasury: PublicKey | null = key()) => snap({
      superpositions: [{ key: key(), acc: {
        owner: key(), world: key(), index: 7, world2: PublicKey.default, index2: 0, commitment: new Uint8Array(32).fill(1),
        commitSlot: 0n, targetSlot: 1n, observed: false, observedSlot: 0n, entropy: seed, // far past any reveal window
        revealDeadline: 0n, stake: 20_000_000n, rearms: 0,
      } }],
      vrf: st ? new Map([[seedHex(seed), st]]) : new Map(), oraoTreasury: treasury ?? undefined,
    });
    const kinds = (x: ReturnType<typeof snap>) => plan(x).filter((a) => a.kind.startsWith("quantum") || a.kind === "vrf_request").map((a) => a.kind);
    expect(kinds(s())).toEqual(["vrf_request"]);
    expect(kinds(s("missing", null))).toEqual([]); // ORAO config unreadable: don't guess the treasury
    expect(kinds(s("pending"))).toEqual([]);
    expect(kinds(s("fulfilled"))).toEqual(["quantum_observe"]);
    const req = plan(s()).find((a) => a.kind === "vrf_request")!;
    const ix = toInstruction(new RecursiaIx(PROGRAM_ID), key(), req);
    expect(ix.programId.equals(ORAO_VRF_ID)).toBe(true);
    expect(ix.keys[3].pubkey.equals(oraoRandomnessPda(seed))).toBe(true);
    const obs = plan(s("fulfilled")).find((a) => a.kind === "quantum_observe")!;
    expect(toInstruction(new RecursiaIx(PROGRAM_ID), key(), obs).keys[7].pubkey.equals(oraoRandomnessPda(seed))).toBe(true);
  });
  it("resolves accepted swaps after the target slot, cancels expired offers (also while paused)", () => {
    const w = key();
    const sw = (o: Partial<SwapAccount>): { key: PublicKey; acc: SwapAccount } => ({
      key: key(),
      acc: {
        world: w, offerer: key(), acceptor: key(), indexA: 1, indexB: 2, weightBps: 5_000, premium: 0n, bounty: 200_000n,
        createdSlot: 0n, expirySlot: 1_200_000n, accepted: false, targetSlot: 0n, rearms: 0, vrfSeed: new Uint8Array(32).fill(7), ...o,
      },
    });
    const swaps = [
      sw({ indexA: 1, accepted: true, targetSlot: 1_000_050n }), // ready
      sw({ indexA: 2, accepted: true, targetSlot: 1_000_500n }), // not yet
      sw({ indexA: 3, expirySlot: 1_000_000n }), // expired offer
      sw({ indexA: 4 }), // open offer
      sw({ indexA: 5, accepted: true, targetSlot: 1_000_050n, bounty: 0n }), // nothing to earn
    ];
    const vrf = new Map([[seedHex(new Uint8Array(32).fill(7)), "fulfilled" as const]]);
    const got = plan(snap({ swaps, vrf })).filter((a) => a.kind.startsWith("swap"));
    expect(got.map((a) => `${a.kind}:${"a" in a ? a.a : ""}`)).toEqual(["swap_cancel:3", "swap_resolve:1"]);
    expect(plan(snap({ config: cfg({ paused: true }), swaps, vrf })).map((a) => a.kind)).toEqual(["swap_cancel", "swap_resolve"]);
    const rx = new RecursiaIx(PROGRAM_ID);
    for (const a of got) expect(toInstruction(rx, key(), a).keys.filter((k) => k.isSigner)).toHaveLength(1);
  });

  it("claims unpaid season prizes of the last closed season, skipping paid / empty ranks", () => {
    const winner = key(), second = key();
    const e = (player: PublicKey, points: bigint) => ({ player, points });
    const empty = Array.from({ length: 10 }, () => e(PublicKey.default, 0n));
    const lastTop = [e(winner, 100n), e(second, 50n), ...empty.slice(2)];
    const season = { top: empty, lastId: 1n, lastTop, lastPrizes: [25n, 12n, ...new Array(8).fill(0n)], lastClaimed: 0b10 };
    const acts = seasonPrizes(season);
    expect(acts).toEqual([{ kind: "claim_season_prize", winner, rank: 0 }]);
    expect(plan(snap({ season })).some((a) => a.kind === "claim_season_prize")).toBe(true);
    const rx = new RecursiaIx(PROGRAM_ID, key());
    expect(toInstruction(rx, key(), acts[0]).keys).toHaveLength(7);
  });

  it("settles finished tournaments once, then credits unpaid prizes; running ones are left alone", () => {
    const winner = key();
    const e = (player: PublicKey, points: bigint) => ({ player, points });
    const top = [e(winner, 100n), ...Array.from({ length: 11 }, () => e(PublicKey.default, 0n))];
    const payer = key();
    const base = { entryFee: 700n, players: 3, top, prizes: new Array(12).fill(0n), claimed: 0, payer };
    const t = (o: object) => ({ key: key(), acc: { ...base, seasonId: 1n, tier: 0, pot: 1890n, settled: false, ...o } });
    const running = t({ seasonId: 2n });
    const open = t({});
    const settled = t({ tier: 1, settled: true, prizes: [1890n, ...new Array(11).fill(0n)] });
    const paid = t({ seasonId: 0n, settled: true, prizes: [5n, ...new Array(11).fill(0n)], claimed: 1, pot: 0n });
    const acts = tournamentActions([running, open, settled, paid], 2n);
    expect(acts).toEqual([
      { kind: "tournament_settle", seasonId: 1n, tier: 0 },
      { kind: "claim_tournament_prize", winner, seasonId: 1n, tier: 1, rank: 0 },
      { kind: "close_tournament", seasonId: 0n, tier: 0, payer },
    ]);
    expect(toInstruction(new RecursiaIx(PROGRAM_ID, key()), key(), acts[2]).keys[1].pubkey.equals(payer)).toBe(true);
    const rx = new RecursiaIx(PROGRAM_ID, key());
    expect(toInstruction(rx, key(), acts[0]).keys).toHaveLength(6);
    expect(toInstruction(rx, key(), acts[1]).keys).toHaveLength(7);
    for (const a of acts) expect(toInstruction(rx, key(), a).keys.some((k) => k.isSigner)).toBe(false);
  });
});
