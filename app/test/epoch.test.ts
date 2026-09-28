import { describe, expect, it } from "vitest";
import { worldEpochClaimable } from "../src/lib/epoch";

const base = { epochId: 5n, prevEpochId: 4n, prevClaimed: false, sinkCur: 0n, sinkPrev: 100n };
describe("worldEpochClaimable (mirror of roll_world_epoch + claim_world_epoch)", () => {
  it("rolled, unclaimed, with burn → claimable", () => expect(worldEpochClaimable(base, 5n)).toBe(true));
  it("already claimed → no", () => expect(worldEpochClaimable({ ...base, prevClaimed: true }, 5n)).toBe(false));
  it("no burn in the window → reward 0 → no", () => expect(worldEpochClaimable({ ...base, sinkPrev: 0n }, 5n)).toBe(false));
  it("stale prev window → no", () => expect(worldEpochClaimable({ ...base, prevEpochId: 3n }, 5n)).toBe(false));
  it("one epoch behind: current burn becomes claimable after roll", () => {
    expect(worldEpochClaimable({ ...base, sinkCur: 7n, prevClaimed: true }, 6n)).toBe(true);
    expect(worldEpochClaimable({ ...base, sinkCur: 0n }, 6n)).toBe(false);
  });
  it("two+ epochs behind: window forfeited", () => expect(worldEpochClaimable({ ...base, sinkCur: 7n }, 7n)).toBe(false));
});
