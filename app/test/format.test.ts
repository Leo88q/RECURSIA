import { describe, expect, it } from "vitest";
import { compact, formatAmount, parseAmount, shortAddr, slotsToHuman, toInput, youify } from "../src/lib/format";

describe("parseAmount (money path: no floats, no rounding)", () => {
  it("parses integers, decimals and comma", () => {
    expect(parseAmount("12")).toEqual({ ok: true, value: 12_000_000n });
    expect(parseAmount("12.5")).toEqual({ ok: true, value: 12_500_000n });
    expect(parseAmount(" 0,000001 ")).toEqual({ ok: true, value: 1n });
    expect(parseAmount("1 000")).toEqual({ ok: true, value: 1_000_000_000n });
  });
  it("rejects what would otherwise be silently rounded or misread", () => {
    for (const bad of ["", "1e6", "-5", "+5", "0x10", "1.2.3", "abc", "NaN", "Infinity", "1,000.5"]) expect(parseAmount(bad).ok).toBe(false);
    expect(parseAmount("0.0000001")).toEqual({ ok: false, error: "не больше 6 знаков после запятой" });
    expect(parseAmount("0").ok).toBe(false);
    expect(parseAmount("0", { allowZero: true })).toEqual({ ok: true, value: 0n });
  });
  it("enforces min / max", () => {
    expect(parseAmount("5", { max: 4_000_000n }).ok).toBe(false);
    expect(parseAmount("4", { max: 4_000_000n }).ok).toBe(true);
    expect(parseAmount("1", { min: 2_000_000n }).ok).toBe(false);
  });
  it("precision beyond Number is exact", () => {
    expect(parseAmount("999999999999999.999999")).toEqual({ ok: true, value: 999_999_999_999_999_999_999n });
  });
});

describe("formatting", () => {
  it("formatAmount groups and trims", () => {
    expect(formatAmount(1_234_567_890_000n)).toBe("1\u00a0234\u00a0567,89");
    expect(formatAmount(5_000_000n)).toBe("5");
    expect(formatAmount(-1_500_000n)).toBe("−1,5");
    expect(formatAmount(1n, 2)).toBe("0");
  });
  it("toInput round-trips with parseAmount", () => {
    for (const v of [0n, 1n, 1_500_000n, 123_456_789n, 10n ** 18n]) {
      const p = parseAmount(toInput(v), { allowZero: true });
      expect(p.ok && p.value).toBe(v);
    }
  });
  it("compact / shortAddr / slotsToHuman", () => {
    expect(compact(1_500_000_000n)).toBe("1.5K");
    expect(compact(2_500_000_000_000n)).toBe("2.50M");
    expect(shortAddr("2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik")).toBe("2Grr…wCik");
    expect(slotsToHuman(100)).toBe("≈ 40 с");
    expect(slotsToHuman(9_000)).toBe("≈ 1 ч");
    expect(slotsToHuman(216_000 * 3)).toBe("≈ 3 дн");
  });
});

describe("youify: 2nd-person grammar for the local player", () => {
  it("present tense", () => expect(youify("Вы предлагает Bot квантовый SWAP")).toBe("Вы предлагаете Bot квантовый SWAP"));
  it("past tense", () => {
    expect(youify("Вы опубликовал законы «X»")).toBe("Вы опубликовали законы «X»");
    expect(youify("Вы создал вселенную")).toBe("Вы создали вселенную");
    expect(youify("Вы потерял клетку #3")).toBe("Вы потеряли клетку #3");
    expect(youify("Вы принял SWAP")).toBe("Вы приняли SWAP");
  });
  it("object position", () => expect(youify("Bot предлагает Вы квантовый SWAP")).toBe("Bot предлагает вам квантовый SWAP"));
  it("leaves other players untouched", () => expect(youify("Садовник-1 создал вселенную")).toBe("Садовник-1 создал вселенную"));
});
