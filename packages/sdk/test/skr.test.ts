import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS, MAX_PROTOCOL_BPS, MIN_TICK_POOL_BPS, MAX_ROYALTY_BPS, ONE, SKR_MINT_STR, TOKEN_SYMBOL,
} from "../src/constants.js";
import { splitSpend, splitTick, epochTax } from "../src/economy.js";
import { GameModel } from "../src/model.js";

describe("SKR economy (defaults mirror programs/recursia/src/state.rs)", () => {
  it("uses the official SKR mint", () => {
    expect(TOKEN_SYMBOL).toBe("SKR");
    expect(SKR_MINT_STR).toBe("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
  });

  it("minimum entry ≈ $20: free cell + 1 epoch of tax + one plant = 1053.5 SKR", () => {
    const p = DEFAULT_PARAMS;
    const entry = p.minPrice + epochTax(p.minPrice, p.harbergerBps) + p.plantCost;
    expect(entry).toBe(1_053_500_000n);
    expect(p.tickCost).toBe(700n * ONE);
    expect(p.worldCreateFee).toBe(70_000n * ONE);
    expect(p.moduleRegisterFee).toBe(350_000n * ONE);
  });

  it("studio takes 20% of every spend, the rest goes to the player pool", () => {
    expect(DEFAULT_PARAMS.protocolBps).toBe(2_000);
    expect(DEFAULT_PARAMS.protocolBps).toBeLessThanOrEqual(MAX_PROTOCOL_BPS);
    const { studio, pool } = splitSpend(350n * ONE, DEFAULT_PARAMS.protocolBps);
    expect(studio).toBe(70n * ONE);
    expect(pool).toBe(280n * ONE);
    const p = DEFAULT_PARAMS;
    const t = splitTick(p.tickCost, p.crankerBps, p.protocolBps, p.hostBps, MAX_ROYALTY_BPS, true);
    expect(t.protocol).toBe(140n * ONE);
    expect(t.pool * 10_000n >= p.tickCost * BigInt(MIN_TICK_POOL_BPS)).toBe(true);
  });

  it("nothing is burned: SKR is conserved exactly and pool inflows fund emission", () => {
    const m = new GameModel(DEFAULT_PARAMS, { poolSeed: 0n });
    m.addPlayer("dev", 1_000_000n * ONE);
    m.registerModule("dev", "Life", 8, 12, 100);
    expect(m.treasury).toBe(70_000n * ONE);
    expect(m.rewardPool).toBe(280_000n * ONE);
    m.addPlayer("alice", 200_000n * ONE);
    const w = m.createRootWorld("alice", "W", 0, 0, 10_000n * ONE);
    for (let i = 0; i < 5; i++) { m.advanceSlots(160); m.tick("alice", w.id); }
    expect(m.circulating()).toBe(m.supply);
    m.advanceSlots(Number(DEFAULT_PARAMS.epochSlots));
    const poolBefore = m.rewardPool;
    m.advanceEpoch();
    const reward = m.claimWorldEpoch(w.id);
    // rebate ≤ 100% of what this world paid INTO the pool (+ efficiency ≤ 200% only for live owned cells)
    expect(reward).toBeLessThanOrEqual(w.sinkPrev * 30_000n / 10_000n);
    expect(reward).toBeGreaterThan(0n);
    expect(m.rewardPool).toBe(poolBefore - reward);
    expect(m.circulating()).toBe(m.supply);
  });

  it("anyone can top up the reward pool", () => {
    const m = new GameModel(DEFAULT_PARAMS, { poolSeed: 0n });
    m.addPlayer("studio", 5_000_000n * ONE);
    m.fundRewardPool("studio", 1_000_000n * ONE);
    expect(m.rewardPool).toBe(1_000_000n * ONE);
    expect(() => m.fundRewardPool("studio", 0n)).toThrow();
    expect(m.circulating()).toBe(m.supply);
  });
});
