import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, ONE, SKR_MINT_STR, WORLD_SPACE } from "@recursia/sdk";
import { ACCOUNT_BYTES, SKR_USD_APPROX, entryCost, usdApprox, priceList, rentLamports, slotsHuman } from "../src/lib/costs";
import { CONFIG } from "../src/lib/config";

describe("entry cost (landing numbers)", () => {
  it("matches the on-chain defaults", () => {
    const c = entryCost();
    expect(c.claim).toBe(700n * ONE);
    expect(c.deposit).toBe(3_500_000n); // 3.5 SKR = 0.5% of 700 SKR per epoch
    expect(c.plant).toBe(350n * ONE);
    expect(c.minTotal).toBe(1_053_500_000n);
    expect(c.weekTotal).toBe(1_074_500_000n);
    // the user's target: a ~$20 minimum entry at the SKR price of the time
    expect(usdApprox(c.minTotal)).toBe(20);
  });
  it("rent matches Solana's rent-exempt minimum for the program's accounts", () => {
    expect(rentLamports(0)).toBe(890_880); // well-known 0-byte minimum
    expect(rentLamports(165)).toBe(2_039_280); // well-known SPL token account minimum
    const c = entryCost();
    expect(c.rentPlayer).toBe(1_433_760); // (128 + 78) × 6960
    expect(c.rentTerritory).toBe(2_004_480);
    expect(c.solMax).toBe(1_433_760 + 2_004_480 + 2_039_280 + 10_000);
    expect(c.solMax / 1e9).toBeLessThan(0.0055);
  });
  it("account sizes stay in sync with the SDK layout", () => {
    expect(ACCOUNT_BYTES.world).toBe(WORLD_SPACE);
  });
  it("follows governance-changed params", () => {
    const c = entryCost({ ...DEFAULT_PARAMS, minPrice: 20n * ONE, harbergerBps: 100, plantCost: 1n * ONE });
    expect(c.minTotal).toBe(20n * ONE + 200_000n + 1n * ONE);
  });
  it("price list covers every paid action", () => {
    const rows = priceList(DEFAULT_PARAMS, (v) => `${Number(v) / 1e6}`, (l) => `${l}`);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.map((r) => r.what).join("|")).toMatch(/клетку.*Посадить.*Суперпозиция.*SWAP.*мир.*закон.*ИИ/s);
    for (const r of rows) expect(r.rcr && r.sol && r.back).toBeTruthy();
  });
  it("the game token is the official Solana Mobile SKR mint", () => {
    expect(SKR_MINT_STR).toBe("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
    expect(CONFIG.mint).toBe(SKR_MINT_STR);
    expect(SKR_USD_APPROX).toBeGreaterThan(0);
  });
  it("durations", () => {
    expect(slotsHuman(150)).toBe("≈1 мин");
    expect(slotsHuman(216_000)).toBe("≈24 ч");
    expect(slotsHuman(21_600)).toBe("≈2,4 ч");
    expect(slotsHuman(32)).toBe("≈12,8 с");
  });
});
