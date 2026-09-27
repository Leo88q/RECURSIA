import { describe, expect, it } from "vitest";
import { GameModel } from "../src/model.js";
import { ONE, PHYSICS_PRESETS } from "../src/constants.js";
import { Rng } from "../src/agents.js";
import { lawError, lawString, maskOf, moduleVitality, mutateLaw, parseLaw, pickModuleByVitality, probeLaw, type Law } from "../src/physics.js";

const life: Law = { birth: maskOf(3), survive: maskOf(2, 3), qBirth: 0, qSurvive: 0, qAmp: 0, royaltyBps: 100 };

describe("physics lab", () => {
  it("lawError mirrors the contract", () => {
    expect(lawError(life)).toBeNull();
    expect(lawError({ ...life, birth: life.birth | 1 })).toMatch(/B0/);
    expect(lawError({ ...life, birth: 0 })).toMatch(/рождения/);
    expect(lawError({ ...life, royaltyBps: 501 })).toMatch(/роялти/);
    expect(lawError({ ...life, qBirth: maskOf(3), qAmp: 1 })).toMatch(/пересекаться/);
    expect(lawError({ ...life, qBirth: maskOf(6), qAmp: 0 })).toMatch(/амплитуда/);
    expect(lawError({ ...life, qBirth: 1, qAmp: 1 })).toMatch(/B0/);
    expect(lawError({ ...life, qBirth: maskOf(6), qAmp: 4 })).toMatch(/амплитуда/);
    expect(lawError({ ...life, survive: 1 << 9 })).toMatch(/диапазона/);
    // every preset registered on-chain must pass
    for (const p of PHYSICS_PRESETS) expect(lawError(p)).toBeNull();
    // and the model (which mirrors the program) agrees on rejects
    const m = new GameModel(); m.addPlayer("a", 1_000_000n * ONE);
    expect(() => m.registerModule("a", "bad", maskOf(3), maskOf(2, 3), 100, { qBirth: maskOf(3), qSurvive: 0, qAmp: 1 })).toThrow();
  });
  it("parse ↔ format round-trips", () => {
    for (const p of PHYSICS_PRESETS) {
      const s = `B${[...Array(9).keys()].filter((i) => (p.birth >> i) & 1).join("")}/S${[...Array(9).keys()].filter((i) => (p.survive >> i) & 1).join("")}`
        + (p.qAmp ? `/qB${[...Array(9).keys()].filter((i) => (p.qBirth >> i) & 1).join("")}/qS${[...Array(9).keys()].filter((i) => (p.qSurvive >> i) & 1).join("")}/a${p.qAmp}` : "");
      const l = parseLaw(s)!;
      expect(l).toEqual({ birth: p.birth, survive: p.survive, qBirth: p.qBirth, qSurvive: p.qSurvive, qAmp: p.qAmp });
    }
    expect(lawString(parseLaw("b36/s23/qs4/a2")!)).toBe("B36/S23 ⚛qS4 p=¼");
    expect(parseLaw("B9/S2")).toBeNull();
    expect(parseLaw("X3")).toBeNull();
  });
  it("probe tells life from extinction and explosion", () => {
    expect(probeLaw(life).verdict).toBe("жизнь");
    expect(probeLaw({ ...life, birth: maskOf(8), survive: 0 }).verdict).toBe("вымирание");
    const boom = probeLaw({ birth: maskOf(1, 2, 3, 4, 5, 6, 7, 8), survive: 0x1ff, qBirth: 0, qSurvive: 0, qAmp: 0 });
    expect(boom.verdict).toBe("взрыв");
    expect(probeLaw(life).vitality).toBeGreaterThan(boom.vitality);
    // deterministic
    expect(probeLaw(PHYSICS_PRESETS[8], 32)).toEqual(probeLaw(PHYSICS_PRESETS[8], 32));
  });
  it("mutateLaw always yields a valid law", () => {
    const r = new Rng(42);
    let l: Law = { ...PHYSICS_PRESETS[7], royaltyBps: 250 };
    for (let i = 0; i < 300; i++) { l = mutateLaw(l, r); expect(lawError(l)).toBeNull(); }
  });
  it("vitality-weighted choice prefers lively physics", () => {
    const m = new GameModel(); m.addPlayer("a", 1_000_000n * ONE);
    m.registerModule("a", "Life", life.birth, life.survive, 100);
    m.registerModule("a", "Dead", maskOf(8), 0, 100);
    const cache = new Map<number, number>();
    expect(moduleVitality(m, 0, cache)).toBeGreaterThan(moduleVitality(m, 1, cache));
    const r = new Rng(3); let lifeCount = 0;
    for (let i = 0; i < 200; i++) if (pickModuleByVitality(m, r, undefined, cache) === 0) lifeCount++;
    expect(lifeCount).toBeGreaterThan(180);
  });
});
