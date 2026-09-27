import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, ONE, PROGRAM_ID_STR, WORLD_SPACE } from "@recursia/sdk";
import { ACCOUNT_BYTES, DEFAULT_MINT, entryCost, priceList, rentLamports, slotsHuman } from "../src/lib/costs";

describe("entry cost (landing numbers)", () => {
  it("matches the on-chain defaults", () => {
    const c = entryCost();
    expect(c.claim).toBe(10n * ONE);
    expect(c.deposit).toBe(50_000n); // 0.05 RCR = 0.5% of 10 RCR per epoch
    expect(c.plant).toBe(5n * ONE);
    expect(c.minTotal).toBe(15_050_000n);
    expect(c.weekTotal).toBe(15_350_000n);
  });
  it("rent matches Solana's rent-exempt minimum for the program's accounts", () => {
    expect(rentLamports(0)).toBe(890_880); // well-known 0-byte minimum
    expect(rentLamports(165)).toBe(2_039_280); // well-known SPL token account minimum
    const c = entryCost();
    expect(c.rentPlayer).toBe(1_322_400);
    expect(c.rentTerritory).toBe(2_004_480);
    expect(c.solMax).toBe(1_322_400 + 2_004_480 + 2_039_280 + 10_000);
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
  it("mint shown on the landing is the program's mint PDA", () => {
    expect(PublicKey.findProgramAddressSync([new TextEncoder().encode("mint")], new PublicKey(PROGRAM_ID_STR))[0].toBase58()).toBe(DEFAULT_MINT);
  });
  it("durations", () => {
    expect(slotsHuman(150)).toBe("≈1 мин");
    expect(slotsHuman(216_000)).toBe("≈24 ч");
    expect(slotsHuman(21_600)).toBe("≈2,4 ч");
    expect(slotsHuman(32)).toBe("≈12,8 с");
  });
});
