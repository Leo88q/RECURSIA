import { describe, expect, it } from "vitest";
import { P } from "./params.js";
import { GameModel, idBytes } from "../src/model.js";
import { ONE, PHYSICS_PRESETS } from "../src/constants.js";
import { epochTax } from "../src/economy.js";
import { bigbang, getCell, quantumMask, step, stepNQ, type Grid, type Quantum } from "../src/sim.js";
import { collapse, commitment, neighbour, quantumRuleError, slotHashLookup, QUANTUM_DELAY_SLOTS, QUANTUM_REVEAL_SLOTS, SWAP_OFFER_TTL_SLOTS } from "../src/quantum.js";
import { blockPattern as blockPatternOf } from "../src/sim.js";
import { Rng } from "../src/agents.js";

// ---------------------------------------------------------------- engine
function naiveStepQ(g: Grid, b: number, s: number, q: Quantum, gen: bigint): Grid {
  const out = new BigUint64Array(64);
  for (let y = 0; y < 64; y++) {
    const m = quantumMask(q, gen, y);
    for (let x = 0; x < 64; x++) {
      let n = 0;
      for (const dy of [63, 0, 1]) for (const dx of [63, 0, 1]) if ((dx || dy) && getCell(g, (x + dx) % 64, (y + dy) % 64)) n++;
      const alive = getCell(g, x, y);
      const cls = alive ? (s >> n) & 1 : (b >> n) & 1;
      const qf = alive ? !((s >> n) & 1) && (q.qSurvive >> n) & 1 : !((b >> n) & 1) && (q.qBirth >> n) & 1;
      if (cls || (qf && (m >> BigInt(x)) & 1n)) out[y] |= 1n << BigInt(x);
    }
  }
  return out;
}

describe("quantum engine", () => {
  it("fast quantum step == naive per-cell reference", () => {
    const r = new Rng(7);
    for (const amp of [1, 2, 3]) {
      const g = bigbang(new Uint8Array(32).fill(amp));
      const q: Quantum = { qBirth: 1 << 6, qSurvive: (1 << 1) | (1 << 4), amp, seed: [r.big64(), r.big64(), r.big64(), r.big64()] };
      expect(stepNQ(g, 8, 12, q, 99n, 1)).toEqual(naiveStepQ(g, 8, 12, q, 100n));
    }
  });
  it("amp 0 reduces to the classical rule", () => {
    const g = bigbang(new Uint8Array(32).fill(9));
    expect(stepNQ(g, 8, 12, { qBirth: 0, qSurvive: 0, amp: 0, seed: [1n, 2n, 3n, 4n] }, 0n, 1)).toEqual(step(g, 8, 12));
  });
  it("different entropy → different futures (cannot be precomputed)", () => {
    const g = bigbang(new Uint8Array(32).fill(3));
    const q = (s: bigint): Quantum => ({ qBirth: 1 << 6, qSurvive: 1 << 4, amp: 2, seed: [s, 2n, 3n, 4n] });
    expect(stepNQ(g, 8, 12, q(1n), 0n, 8)).not.toEqual(stepNQ(g, 8, 12, q(2n), 0n, 8));
    expect(stepNQ(g, 8, 12, q(1n), 0n, 8)).toEqual(stepNQ(g, 8, 12, q(1n), 0n, 8));
  });
  it("rule validator mirrors the program", () => {
    expect(quantumRuleError(8, 12, 1 << 6, 1 << 4, 2)).toBeNull();
    expect(quantumRuleError(8, 12, 1, 0, 1)).toMatch(/B0/);
    expect(quantumRuleError(8, 12, 8, 0, 1)).toMatch(/overlap/);
    expect(quantumRuleError(8, 12, 1 << 6, 0, 4)).toMatch(/amp/);
    expect(quantumRuleError(8, 12, 1 << 6, 0, 0)).toMatch(/amp=0/);
  });
});

describe("quantum primitives", () => {
  it("slot hash lookup handles skipped slots and expiry", () => {
    const mk = (slots: number[]) => {
      const d = new Uint8Array(8 + slots.length * 40); const dv = new DataView(d.buffer);
      dv.setBigUint64(0, BigInt(slots.length), true);
      slots.forEach((s, i) => { dv.setBigUint64(8 + i * 40, BigInt(s), true); d[16 + i * 40] = s & 0xff; });
      return d;
    };
    const d = mk([100, 99, 98, 96, 94, 93]);
    expect(slotHashLookup(d, 97)).toMatchObject({ kind: "found", slot: 98n });
    expect(slotHashLookup(d, 95)).toMatchObject({ kind: "found", slot: 96n });
    expect(slotHashLookup(d, 101)?.kind).toBe("notYet");
    const full = mk(Array.from({ length: 512 }, (_, i) => 1000 - i));
    expect(slotHashLookup(full, 100)?.kind).toBe("expired");
    expect(slotHashLookup(full, 489)).toMatchObject({ kind: "found", slot: 489n });
  });
  it("collapse frequency follows the committed amplitude", () => {
    let a = 0; const N = 4000;
    const c = commitment(1n, 2n, 3000, new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
    for (let i = 0; i < N; i++) { const e = new Uint8Array(32); new DataView(e.buffer).setUint32(0, i); if (collapse(e, c, 3000).branchA) a++; }
    expect(a / N).toBeGreaterThan(0.27); expect(a / N).toBeLessThan(0.33);
  });
  it("torus neighbours", () => {
    expect(neighbour(0, 0)).toBe(56); expect(neighbour(0, 3)).toBe(7); expect(neighbour(63, 1)).toBe(56); expect(neighbour(63, 2)).toBe(7);
  });
});

// ---------------------------------------------------------------- model
function setup() {
  const m = new GameModel(P);
  m.addPlayer("dev", 1_000_000n * ONE);
  const foam = PHYSICS_PRESETS.find((p) => p.name === "Quantum Foam")!;
  m.registerModule("dev", foam.name, foam.birth, foam.survive, foam.royaltyBps, foam);
  m.registerModule("dev", "Life", 8, 12, 100);
  m.addPlayer("alice", 100_000n * ONE);
  m.addPlayer("bob", 100_000n * ONE);
  m.addPlayer("keeper", 0n);
  const w = m.createRootWorld("alice", "Foam", 0, 1_000, 5_000n * ONE);
  const w2 = m.createRootWorld("alice", "Other", 1, 1_000, 5_000n * ONE);
  const dep = epochTax(100n * ONE, P.harbergerBps) * 5n;
  m.acquire("bob", w.id, 5, 10n * ONE, 100n * ONE, dep);
  m.acquire("bob", w2.id, 9, 10n * ONE, 100n * ONE, dep);
  return { m, w, w2 };
}
const salt = new Uint8Array(32).fill(42);
const A = 0x0000_0000_0007_0402n, B = 0x0000_0018_1800_0000n;

describe("quantum game model", () => {
  it("quantum worlds tick with slot-hash entropy and stay reproducible", () => {
    const { m, w } = setup();
    m.advanceSlots(200); m.tick("keeper", w.id);
    expect(w.entropy).not.toBeNull();
    const m2 = setup().m; m2.advanceSlots(200); m2.tick("keeper", w.id);
    expect(m2.world(w.id).grid).toEqual(w.grid);
  });

  it("commit → observe → collapse (entangled), stake refunded, supply conserved", () => {
    const { m, w, w2 } = setup();
    const c = m.commitFor("bob", w.id, 5, A, B, 6_000, salt);
    const before = m.players.get("bob")!.wallet;
    m.quantumCommit("bob", w.id, 5, c, { world: w2.id, index: 9 });
    const stake = m.quantumStake(true);
    expect(before - m.players.get("bob")!.wallet).toBe(stake + 2n * P.plantCost);
    expect(() => m.quantumObserve("keeper", w.id, 5)).toThrow(/not measurable/);
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    expect(m.quantumObserve("keeper", w.id, 5)).toBe("observed");
    expect(m.players.get("keeper")!.wallet).toBe(stake / 20n);
    const pv = m.previewCollapse(w.id, 5, 6_000)!;
    const res = m.quantumCollapse("bob", w.id, 5, A, B, 6_000, salt);
    expect(res.branchA).toBe(pv.branchA);
    expect(m.superposition(w.id, 5)).toBeUndefined();
    expect(w.quantumEscrow).toBe(0n);
    expect(m.circulating()).toBe(m.supply);
  });

  it("wrong preimage / other owner / copied commitment are rejected", () => {
    const { m, w } = setup();
    const c = m.commitFor("bob", w.id, 5, A, B, 5_000, salt);
    m.quantumCommit("bob", w.id, 5, c);
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    m.quantumObserve("keeper", w.id, 5);
    expect(() => m.quantumCollapse("bob", w.id, 5, A, B, 5_001, salt)).toThrow(/mismatch/);
    expect(() => m.quantumCollapse("bob", w.id, 5, B, A, 5_000, salt)).toThrow(/mismatch/);
    expect(() => m.quantumCollapse("alice", w.id, 5, A, B, 5_000, salt)).toThrow(/not owner/);
    // commitment is bound to owner: the same inputs for alice hash differently
    expect(commitment(A, B, 5_000, salt, idBytes("alice"), w.key, 5)).not.toEqual(c);
  });

  it("no double superposition / respects plant cooldown (dup guard)", () => {
    const { m, w } = setup();
    m.quantumCommit("bob", w.id, 5, m.commitFor("bob", w.id, 5, A, B, 5_000, salt));
    expect(m.canQuantumCommit("bob", w.id, 5)).toMatch(/already|cooldown/);
    expect(() => m.plant("bob", w.id, 5, A)).toThrow(/cooldown/);
  });

  it("withholding a bad outcome costs the stake (decoherence)", () => {
    const { m, w } = setup();
    m.quantumCommit("bob", w.id, 5, m.commitFor("bob", w.id, 5, A, B, 5_000, salt));
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    m.quantumObserve("keeper", w.id, 5);
    expect(m.canDecohere(w.id, 5)).toMatch(/coherent/);
    m.advanceSlots(QUANTUM_REVEAL_SLOTS + 1);
    const pool0 = m.rewardPool;
    m.quantumDecohere("keeper", w.id, 5);
    expect(m.rewardPool).toBeGreaterThan(pool0); // forfeited stake is recycled to players, not burned
    expect(m.superposition(w.id, 5)).toBeUndefined();
    expect(() => m.quantumCollapse("bob", w.id, 5, A, B, 5_000, salt)).toThrow(/no superposition/);
  });

  it("late observation re-arms and burns 25% (no stale-hash grinding)", () => {
    const { m, w } = setup();
    m.quantumCommit("bob", w.id, 5, m.commitFor("bob", w.id, 5, A, B, 5_000, salt));
    const s0 = m.superposition(w.id, 5)!.stake;
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 600);
    expect(m.quantumObserve("keeper", w.id, 5)).toBe("rearmed");
    expect(m.superposition(w.id, 5)!.stake).toBe(s0 - s0 / 4n);
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    expect(m.quantumObserve("keeper", w.id, 5)).toBe("observed");
  });

  it("territory sold mid-superposition: grid untouched, owner still refunded", () => {
    const { m, w } = setup();
    m.quantumCommit("bob", w.id, 5, m.commitFor("bob", w.id, 5, A, B, 5_000, salt));
    m.acquire("alice", w.id, 5, 100n * ONE, 120n * ONE, epochTax(120n * ONE, P.harbergerBps) * 3n);
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    m.quantumObserve("keeper", w.id, 5);
    const grid = w.grid.slice();
    const wallet = m.players.get("bob")!.wallet;
    m.quantumCollapse("bob", w.id, 5, A, B, 5_000, salt);
    expect(w.grid).toEqual(grid);
    expect(m.players.get("bob")!.wallet).toBeGreaterThan(wallet);
  });

  it("settlement works while paused, new commits do not", () => {
    const { m, w } = setup();
    m.quantumCommit("bob", w.id, 5, m.commitFor("bob", w.id, 5, A, B, 5_000, salt));
    m.paused = true;
    expect(m.canQuantumCommit("bob", w.id, 5)).toBe("paused");
    m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
    m.quantumObserve("keeper", w.id, 5);
    m.quantumCollapse("bob", w.id, 5, A, B, 5_000, salt);
  });
});

describe("AI agents in a quantum world", () => {
  it("superpose, observe, collapse; invariants hold; no superposition leaks", async () => {
    const { AIAgent } = await import("../src/agents.js");
    const m = new GameModel(P);
    m.addPlayer("dev", 1_000_000n * ONE);
    for (const p of PHYSICS_PRESETS) m.registerModule("dev", p.name, p.birth, p.survive, p.royaltyBps, p);
    const qi = PHYSICS_PRESETS.findIndex((p) => p.name === "Quantum Foam");
    m.addPlayer("arch", 100_000n * ONE);
    m.createRootWorld("arch", "Foam", qi, 1_000, 20_000n * ONE);
    const agents = (["speculator", "demiurge", "gardener", "expansionist"] as const).flatMap((k, i) =>
      [0, 1].map((j) => { const id = `q-${k}-${j}`; m.addPlayer(id, 20_000n * ONE, true); return new AIAgent(id, k, 77 + i * 10 + j); }));
    let commits = 0, collapses = 0;
    for (let r = 0; r < 100; r++) {
      m.advanceSlots(160);
      for (const id of m.worlds.keys()) if (!m.canTick(id)) m.tick("dev", id);
      for (const a of agents) a.act(m);
      if (m.canAdvanceEpoch()) m.advanceEpoch();
      m.check();
    }
    for (const e of m.events) { if (/суперпозицию/.test(e.text)) commits++; if (/Коллапс/.test(e.text)) collapses++; }
    expect(commits).toBeGreaterThan(3);
    expect(collapses).toBeGreaterThan(0);
    expect(m.superpositions.size).toBeLessThanOrEqual(agents.length * 2);
    expect(m.circulating()).toBe(m.supply);
  });
});

describe("neutral-world SWAP", () => {
  it("swapRoll matches the Rust vector", async () => {
    const { swapRoll } = await import("../src/quantum.js");
    const e = new Uint8Array(32).map((_, i) => i);
    const s = new Uint8Array(32).map((_, i) => 255 - i);
    expect(swapRoll(e, s)).toBe(7480);
    expect(swapRoll(new Uint8Array(32), new Uint8Array(32))).toBe(6933);
  });
  it("swapBlocks is an involution that moves patterns intact", async () => {
    const { swapBlocks, writeBlock, blockPattern } = await import("../src/sim.js");
    const g = new BigUint64Array(64);
    writeBlock(g, 10, 0x0000000000070204n);
    writeBlock(g, 60, 0xffn);
    swapBlocks(g, 10, 60);
    expect(blockPattern(g, 60)).toBe(0x0000000000070204n);
    expect(blockPattern(g, 10)).toBe(0xffn);
    swapBlocks(g, 60, 10);
    expect(blockPattern(g, 10)).toBe(0x0000000000070204n);
  });
});

describe("neutral world + SWAP market (model)", () => {
  const setup = () => {
    const m = new GameModel(P);
    m.addPlayer("dev", 1_000_000n * ONE);
    const foam = PHYSICS_PRESETS.find((p) => p.name === "Quantum Foam")!;
    m.registerModule("dev", foam.name, foam.birth, foam.survive, foam.royaltyBps, foam);
    m.registerModule("dev", "Life", 8, 12, 100);
    for (const p of ["alice", "bob", "carol", "keeper"]) m.addPlayer(p, 100_000n * ONE);
    const w = m.createNeutralWorld("carol", "Нейтраль", 0, 5_000n * ONE);
    const dep = epochTax(100n * ONE, P.harbergerBps) * 5n;
    m.acquire("alice", w.id, 3, 10n * ONE, 100n * ONE, dep);
    m.acquire("bob", w.id, 40, 10n * ONE, 100n * ONE, dep);
    return { m, w };
  };
  it("neutral world has no ruler and needs quantum physics", () => {
    const { m, w } = setup();
    expect(w.architect).toBeNull();
    expect(w.neutral && w.liberated).toBe(true);
    expect(() => m.startRebellion("alice", w.id, 3)).toThrow();
    expect(() => m.createNeutralWorld("carol", "Classic", 1, 0n)).toThrow(/quantum/);
    const plain = m.createRootWorld("carol", "Plain", 0, 0, 0n);
    expect(m.canSwapOffer("alice", plain.id, 3, 40, 5_000, 0n)).toMatch(/neutral/);
  });
  it("offer → accept → resolve: premium to acceptor, blocks exchange iff roll < weight, invariants hold", () => {
    let swapped = 0, stayed = 0;
    for (let i = 0; i < 24; i++) {
      const { m, w } = setup();
      m.chainSalt = new Uint8Array(32).fill(i);
      const pa = blockPatternOf(w.grid, 3), pb = blockPatternOf(w.grid, 40);
      const bobClaim = m.players.get("bob")!.claimable;
      const sunk = m.totalSunk, studio = m.treasury;
      m.swapOffer("alice", w.id, 3, 40, 5_000, 7n * ONE);
      const spent = P.plantCost - P.plantCost / 5n; // 4/5 of the fee; 1/5 = resolver bounty
      expect(m.treasury - studio).toBe(spent * BigInt(P.protocolBps) / 10_000n);
      expect(m.totalSunk - sunk).toBe(spent - (m.treasury - studio));
      expect(m.canSwapAccept("carol", w.id, 3, 40)).toMatch(/not addressed/);
      m.swapAccept("bob", w.id, 3, 40);
      expect(m.canSwapResolve(w.id, 3, 40)).toMatch(/not measurable/);
      m.advanceSlots(QUANTUM_DELAY_SLOTS + 1);
      const r = m.swapResolve("keeper", w.id, 3, 40);
      expect(m.players.get("bob")!.claimable - bobClaim).toBe(7n * ONE);
      if (r === "swapped") { swapped++; expect(blockPatternOf(w.grid, 3)).toBe(pb); expect(blockPatternOf(w.grid, 40)).toBe(pa); }
      else { stayed++; expect(blockPatternOf(w.grid, 3)).toBe(pa); }
      expect(w.quantumEscrow).toBe(0n);
      expect(m.swaps.size).toBe(0);
    }
    expect(swapped).toBeGreaterThan(3);
    expect(stayed).toBeGreaterThan(3);
  });
  it("cancel: offerer anytime before accept, others only after expiry; premium refunded as claimable", () => {
    const { m, w } = setup();
    m.swapOffer("alice", w.id, 3, 40, 2_000, 5n * ONE);
    expect(m.canSwapCancel("keeper", w.id, 3, 40)).toMatch(/still open/);
    m.advanceSlots(SWAP_OFFER_TTL_SLOTS + 1);
    expect(m.canSwapAccept("bob", w.id, 3, 40)).toBe("expired");
    const before = m.players.get("alice")!.claimable;
    m.swapCancel("keeper", w.id, 3, 40);
    expect(m.players.get("alice")!.claimable - before).toBe(5n * ONE);
    expect(w.quantumEscrow).toBe(0n);
  });
  it("a new holder of block A never inherits an un-accepted offer", () => {
    const { m, w } = setup();
    m.swapOffer("alice", w.id, 3, 40, 5_000, 0n);
    m.acquire("carol", w.id, 3, 1_000n * ONE, 100n * ONE, epochTax(100n * ONE, P.harbergerBps) * 5n);
    expect(m.canSwapAccept("bob", w.id, 3, 40)).toMatch(/offerer lost/);
  });
});

describe("AI in a neutral world", () => {
  it("agents trade swaps, crank them, invent laws; invariants hold; no escrow leaks", async () => {
    const { AIAgent } = await import("../src/agents.js");
    const m = new GameModel(P);
    m.addPlayer("dev", 1_000_000n * ONE);
    for (const p of PHYSICS_PRESETS) m.registerModule("dev", p.name, p.birth, p.survive, p.royaltyBps, p);
    const qi = PHYSICS_PRESETS.findIndex((p) => p.name === "Tunnel Life");
    m.addPlayer("founder", 100_000n * ONE);
    const w = m.createNeutralWorld("founder", "Ничья", qi, 20_000n * ONE);
    const agents = (["speculator", "expansionist", "gardener", "demiurge"] as const).flatMap((k, i) =>
      [0, 1, 2].map((j) => { const id = `n-${k}-${j}`; m.addPlayer(id, 60_000n * ONE, true); return new AIAgent(id, k, 900 + i * 10 + j); }));
    for (let r = 0; r < 120; r++) {
      m.advanceSlots(160);
      for (const id of m.worlds.keys()) if (!m.canTick(id)) m.tick("dev", id);
      for (const a of agents) a.act(m);
    }
    const kinds = m.events.filter((e) => e.kind === "swap").map((e) => e.text);
    expect(kinds.some((t) => t.includes("предлагает"))).toBe(true);
    expect(kinds.some((t) => t.includes("⇄ SWAP"))).toBe(true);
    expect(w.architect).toBeNull();
    let esc = 0n; for (const s of m.swaps.values()) if (s.world === w.id) esc += s.premium + s.bounty;
    for (const sp of m.superpositions.values()) if (sp.world === w.id) esc += sp.stake;
    expect(esc).toBe(w.quantumEscrow);
    m.check();
  }, 60_000);
});
