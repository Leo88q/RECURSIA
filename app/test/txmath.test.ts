import { describe, expect, it } from "vitest";
import { MAX_CU, computeUnitLimit, estimateFeeLamports, pickPriorityFee, readTokenAmount } from "../src/lib/txmath";

describe("tx pipeline math", () => {
  it("CU limit: headroom, fallback, cap", () => {
    expect(computeUnitLimit(100_000)).toBe(120_000);
    expect(computeUnitLimit(undefined)).toBe(400_000);
    expect(computeUnitLimit(0)).toBe(400_000);
    expect(computeUnitLimit(1_390_000)).toBe(MAX_CU);
  });
  it("priority fee is percentile-based and ALWAYS capped", () => {
    const s = [0, 0, 100, 2_000, 3_000, 5_000, 1_000_000_000];
    expect(pickPriorityFee(s, "none", 1e6)).toBe(0);
    expect(pickPriorityFee(s, "normal", 1e6)).toBe(3_000); // median of non-zero samples
    expect(pickPriorityFee(s, "fast", 50_000)).toBe(50_000); // spike clamped
    expect(pickPriorityFee([], "normal", 1e6)).toBe(1_000);
    expect(pickPriorityFee([], "fast", 500)).toBe(500);
    expect(pickPriorityFee([NaN, -5, Infinity], "normal", 1e6)).toBe(1_000);
  });
  it("fee estimate", () => {
    expect(estimateFeeLamports(200_000, 0)).toBe(5_000);
    expect(estimateFeeLamports(200_000, 10_000)).toBe(5_000 + 2_000);
  });
  it("reads SPL token amount (u64 LE @64)", () => {
    const d = new Uint8Array(165);
    new DataView(d.buffer).setBigUint64(64, 123_456_789_012n, true);
    expect(readTokenAmount(d)).toBe(123_456_789_012n);
    expect(readTokenAmount(new Uint8Array(10))).toBeNull();
    expect(readTokenAmount(null)).toBeNull();
  });
});
