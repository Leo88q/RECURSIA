import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, PROGRAM_ID, RecursiaIx, TERRITORIES, type ConfigAccount, type SuperpositionAccount, type SwapAccount, type TerritoryAccount, type WorldAccount } from "@recursia/sdk";
import { claimable, plan, type Snapshot } from "../src/plan.js";
import { toInstruction } from "../src/ix.js";

const P = DEFAULT_PARAMS;
const key = () => Keypair.generate().publicKey;
const cfg = (o: Partial<ConfigAccount> = {}): ConfigAccount => ({
  version: 1, bump: 255, admin: key(), mint: key(), genesisDone: true, paused: false, params: P,
  pending: { kind: 0 } as never, pendingEta: 0n, pendingNonce: 0n, rootWorlds: 1n, totalWorlds: 1n, modules: 1n,
  curEpoch: 5n, epochStartSlot: 1_000_000n, curTotalBurn: 0n, prevTotalBurn: 0n, prevEmission: 0n, prevClaimed: 0n,
  totalBurned: 0n, totalEmitted: 0n, ...o,
});
const world = (o: Partial<WorldAccount> = {}): WorldAccount => ({
  version: 1, bump: 1, vaultBump: 1, depth: 0, parent: PublicKey.default, parentTerritory: 0, index: 0n, architect: key(),
  architectFeeBps: 0, module: key(), birth: 8, survive: 12, name: "w", grid: new BigUint64Array(64), generation: 0n,
  tickCount: 0n, lastTickSlot: 0n, createdSlot: 0n, energy: 1_000n * 1_000_000n, rewardsReserved: 0n, deposits: 0n,
  architectAccrued: 0n, territoryAlive: new Array(TERRITORIES).fill(1), territoryPending: new Array(TERRITORIES).fill(0n),
  ownedMask: 0n, epochId: 5n, burnCur: 0n, scoresCur: new Array(TERRITORIES).fill(0), prevEpochId: 4n, burnPrev: 0n,
  scoresPrev: new Array(TERRITORIES).fill(0), prevClaimed: true, resonance: 0, childCount: 0, rebellionId: 0,
  rebellionVotes: 0, rebellionDeadline: 0n, lastRebellionSlot: 0n, liberated: false, totalBurned: 0n,
  qBirth: 0, qSurvive: 0, qAmp: 0, entropy: new Uint8Array(32), quantumEscrow: 0n, superpositions: 0, neutral: false, ...o,
});
const terr = (w: PublicKey, o: Partial<TerritoryAccount> = {}): TerritoryAccount => ({
  world: w, index: 3, holder: key(), price: 100n * 1_000_000n, deposit: 10n * 1_000_000n, lastTaxSlot: 1_000_000n,
  lastPriceChangeSlot: 0n, nextPlantTick: 0n, acquiredSlot: 0n, votedRebellion: 0, agentManaged: false, childWorld: PublicKey.default, bump: 1, ...o,
});
const snap = (o: Partial<Snapshot>): Snapshot => ({ slot: 1_000_100n, config: cfg(), worlds: [], territories: [], ...o });

describe("keeper planner", () => {
  it("does nothing while paused or before genesis", () => {
    const w = { key: key(), acc: world() };
    expect(plan(snap({ config: cfg({ paused: true }), worlds: [w] }))).toEqual([]);
    expect(plan(snap({ config: cfg({ genesisDone: false }), worlds: [w] }))).toEqual([]);
  });

  it("advances the epoch first, then claims worlds that burned in it", () => {
    const burned = { key: key(), acc: world({ burnCur: 50n }) };
    const idle = { key: key(), acc: world({ burnCur: 0n, lastTickSlot: 1_000_090n }) };
    const acts = plan(snap({ slot: 1_000_000n + P.epochSlots, worlds: [burned, idle] }));
    expect(acts[0]).toEqual({ kind: "advance_epoch" });
    const claims = acts.filter((a) => a.kind === "claim_world_epoch");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ world: burned.key });
  });

  it("mirrors on-chain claim windows exactly", () => {
    expect(claimable(world({ epochId: 4n, burnCur: 1n }), 5n)).toBe(true);
    expect(claimable(world({ epochId: 3n, burnCur: 1n }), 5n)).toBe(false); // skipped epoch → forfeited
    expect(claimable(world({ epochId: 5n, prevEpochId: 4n, prevClaimed: false, burnPrev: 1n }), 5n)).toBe(true);
    expect(claimable(world({ epochId: 5n, prevEpochId: 4n, prevClaimed: true, burnPrev: 1n }), 5n)).toBe(false);
  });

  it("forecloses only territories whose tax exceeds the deposit", () => {
    const w = key();
    // due over 216_000 slots at 0.5%/epoch of 100 RCR = 0.5 RCR
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
    const q = plan(snap({ superpositions: sps })).filter((a) => a.kind.startsWith("quantum"));
    expect(q.map((a) => `${a.kind}:${"index" in a ? a.index : ""}`)).toEqual(["quantum_decohere:3", "quantum_observe:1"]);
    const paused = plan(snap({ config: cfg({ paused: true }), superpositions: sps }));
    expect(paused.map((a) => a.kind)).toEqual(["quantum_observe"]);
    const rx = new RecursiaIx(PROGRAM_ID);
    for (const a of q) expect(toInstruction(rx, key(), a).keys.filter((k) => k.isSigner)).toHaveLength(1);
  });
  it("resolves accepted swaps after the target slot, cancels expired offers (also while paused)", () => {
    const w = key();
    const sw = (o: Partial<SwapAccount>): { key: PublicKey; acc: SwapAccount } => ({
      key: key(),
      acc: {
        world: w, offerer: key(), acceptor: key(), indexA: 1, indexB: 2, weightBps: 5_000, premium: 0n, bounty: 200_000n,
        createdSlot: 0n, expirySlot: 1_200_000n, accepted: false, targetSlot: 0n, rearms: 0, ...o,
      },
    });
    const swaps = [
      sw({ indexA: 1, accepted: true, targetSlot: 1_000_050n }), // ready
      sw({ indexA: 2, accepted: true, targetSlot: 1_000_500n }), // not yet
      sw({ indexA: 3, expirySlot: 1_000_000n }), // expired offer
      sw({ indexA: 4 }), // open offer
      sw({ indexA: 5, accepted: true, targetSlot: 1_000_050n, bounty: 0n }), // nothing to earn
    ];
    const got = plan(snap({ swaps })).filter((a) => a.kind.startsWith("swap"));
    expect(got.map((a) => `${a.kind}:${"a" in a ? a.a : ""}`)).toEqual(["swap_cancel:3", "swap_resolve:1"]);
    expect(plan(snap({ config: cfg({ paused: true }), swaps })).map((a) => a.kind)).toEqual(["swap_cancel", "swap_resolve"]);
    const rx = new RecursiaIx(PROGRAM_ID);
    for (const a of got) expect(toInstruction(rx, key(), a).keys.filter((k) => k.isSigner)).toHaveLength(1);
  });
});
