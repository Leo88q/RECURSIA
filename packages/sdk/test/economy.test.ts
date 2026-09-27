import { describe, expect, it } from "vitest";
import { distribute, epochTax, harbergerDue, splitTick, worldEmission } from "../src/economy.js";
import { DEFAULT_PARAMS } from "../src/constants.js";
import { Rng } from "../src/agents.js";

describe("economy math (mirror of math.rs)", () => {
  it("tick split sums exactly & respects the reward-pool floor", () => {
    const p = DEFAULT_PARAMS;
    for (const host of [true, false]) for (const roy of [0, 100, 500]) {
      const s = splitTick(p.tickCost, p.crankerBps, p.protocolBps, p.hostBps, roy, host);
      expect(s.cranker + s.protocol + s.host + s.royalty + s.pool).toBe(p.tickCost);
      expect(s.pool * 10_000n >= p.tickCost * 3_000n).toBe(true);
    }
  });
  it("harberger rounds up", () => {
    expect(harbergerDue(10_000n, 50, 1n, 216_000n)).toBe(1n);
    expect(harbergerDue(1_000_000n, 100, 216_000n, 216_000n)).toBe(10_000n);
    expect(epochTax(1_000_000n, 100)).toBe(10_000n);
  });
  it("PROPERTY: emission never exceeds rebate cap × burn (self-farming is net-negative)", () => {
    const r = new Rng(99);
    for (let i = 0; i < 20_000; i++) {
      const tb = BigInt(r.int(1e9) + 1), bw = BigInt(r.int(Number(tb)) + 1), em = BigInt(r.int(1e12));
      const got = worldEmission(em, tb, bw, 9_000, 0n);
      expect(got * 10_000n <= bw * 9_000n).toBe(true);
      expect(got <= em).toBe(true);
    }
  });
  it("distribution conserves tokens", () => {
    const r = new Rng(5);
    for (let k = 0; k < 200; k++) {
      const scores = Array.from({ length: 64 }, () => r.int(1000));
      const owned = Array.from({ length: 64 }, () => r.next() < 0.6);
      const amt = BigInt(r.int(1e9));
      const { shares, rest } = distribute(amt, scores, owned);
      expect(shares.reduce((a, b) => a + b, 0n) + rest).toBe(amt);
      shares.forEach((s, i) => { if (!owned[i]) expect(s).toBe(0n); });
    }
  });
});
