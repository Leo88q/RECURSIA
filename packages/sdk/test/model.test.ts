import { describe, expect, it } from "vitest";
import { P } from "./params.js";
import { GameModel } from "../src/model.js";
import { AIAgent, type Personality } from "../src/agents.js";
import { ONE, PHYSICS_PRESETS } from "../src/constants.js";
import { epochTax } from "../src/economy.js";

function setup() {
  const m = new GameModel(P);
  m.addPlayer("dev", 1_000_000n * ONE);
  for (const p of PHYSICS_PRESETS) m.registerModule("dev", p.name, p.birth, p.survive, p.royaltyBps);
  m.addPlayer("alice", 100_000n * ONE);
  m.addPlayer("bob", 100_000n * ONE);
  const w = m.createRootWorld("alice", "Genesis", 0, 2_000, 5_000n * ONE);
  return { m, w };
}

describe("game model", () => {
  it("full lifecycle keeps supply invariant", () => {
    const { m, w } = setup();
    const dep = epochTax(100n * ONE, P.harbergerBps) * 5n;
    m.acquire("bob", w.id, 5, 10n * ONE, 100n * ONE, dep);
    m.advanceSlots(200);
    m.tick("bob", w.id);
    m.plant("bob", w.id, 5, 0x0000_0000_0007_0402n);
    // alice buys bob's territory at his self-assessed price
    m.acquire("alice", w.id, 5, 100n * ONE, 150n * ONE, dep * 2n);
    expect(m.players.get("bob")!.claimable).toBeGreaterThan(100n * ONE - 1n);
    m.withdraw("bob", m.players.get("bob")!.claimable);
    expect(m.circulating()).toBe(m.supply);
  });

  it("slippage guard rejects front-run price raise", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 1, 10n * ONE, 1_000n * ONE, epochTax(1_000n * ONE, 50) * 2n);
    expect(() => m.acquire("alice", w.id, 1, 500n * ONE, 600n * ONE, 10n * ONE)).toThrow(/slippage/);
  });

  it("cannot plant twice in the same tick (dup-exploit guard)", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 2, 10n * ONE, 50n * ONE, 5n * ONE);
    m.plant("bob", w.id, 2, 1n);
    expect(() => m.plant("bob", w.id, 2, 3n)).toThrow(/cooldown/);
  });

  it("foreclosure when deposit runs out", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 3, 10n * ONE, 100n * ONE, epochTax(100n * ONE, 50));
    m.advanceSlots(Number(P.epochSlots) + 10);
    m.settle(w.id, 3);
    expect(w.territories[3].holder).toBeNull();
  });

  it("child universe: dormant when host block dies, host tax flows up", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 9, 10n * ONE, 100n * ONE, 50n * ONE);
    m.plant("bob", w.id, 9, 0x0000_0018_1800_0000n); // block (still life) keeps host alive
    const c = m.createChildWorld("bob", w.id, 9, "Inner", 1, 1_000, 1_000n * ONE);
    m.advanceSlots(200);
    m.tick("alice", c.id);
    expect(w.pending[9]).toBe(P.tickCost * 1500n / 10_000n);
    // kill host block
    m.advanceSlots(200);
    m.tick("alice", w.id);
    w.grid.fill(0n); w.alive = w.alive.map(() => 0);
    m.advanceSlots(200);
    expect(m.canTick(c.id)).toBe("dormant");
  });

  it("emission rebate: sybil self-burn is net negative", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 0, 10n * ONE, 20n * ONE, 5n * ONE);
    const before = m.players.get("alice")!.wallet + m.players.get("bob")!.wallet;
    for (let i = 0; i < 50; i++) { m.advanceSlots(160); m.tick("alice", w.id); }
    m.advanceSlots(Number(P.epochSlots));
    m.advanceEpoch();
    const r = m.claimWorldEpoch(w.id);
    expect(r <= w.sinkPrev * 9_000n / 10_000n).toBe(true);
    void before;
  });

  it("rebellion liberates a world", () => {
    const { m, w } = setup();
    const ids = Array.from({ length: 9 }, (_, i) => `r${i}`);
    ids.forEach((id, i) => { m.addPlayer(id, 1_000n * ONE); m.acquire(id, w.id, 20 + i, 10n * ONE, 10n * ONE, 5n * ONE); });
    m.advanceSlots(5);
    m.startRebellion("r0", w.id, 20);
    ids.slice(1).forEach((id, i) => m.voteRebellion(id, w.id, 21 + i));
    expect(m.canExecuteRebellion(w)).toBe(true);
    m.executeRebellion(w.id);
    expect(w.architect).toBeNull();
    expect(w.liberated).toBe(true);
  });

  it("AI agents play 300 rounds without breaking invariants; permits bound them", () => {
    const { m, w } = setup();
    void w;
    const kinds: Personality[] = ["gardener", "expansionist", "speculator", "demiurge"];
    const agents = kinds.flatMap((k, i) => [0, 1].map((j) => { const id = `ai-${k}-${j}`; m.addPlayer(id, 20_000n * ONE, true); return new AIAgent(id, k, 1000 + i * 10 + j); }));
    m.addPlayer("owner", 10_000n * ONE);
    m.createPermit("owner", "bot", 500n * ONE, 100n * ONE, 50n * ONE, 1_000_000);
    expect(() => m.acquire("bot", "root-0", 60, 60n * ONE, 60n * ONE, 5n * ONE, { agentOwner: "owner" })).toThrow(/permit/);
    for (let r = 0; r < 300; r++) {
      m.advanceSlots(160);
      for (const id of m.worlds.keys()) if (!m.canTick(id)) m.tick("dev", id);
      for (const a of agents) a.act(m);
      if (m.canAdvanceEpoch()) m.advanceEpoch();
      m.check();
    }
    expect(m.circulating()).toBe(m.supply);
  });
});
