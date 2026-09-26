import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GLIDER, bigbang, emptyGrid, getCell, population, step, stepN, territoryCounts, writeBlock, orBlock } from "../src/sim.js";
import { PHYSICS_PRESETS } from "../src/constants.js";
import { Rng } from "../src/agents.js";

const LIFE = PHYSICS_PRESETS[0];

function naive(g: BigUint64Array, b: number, s: number) {
  const o = emptyGrid();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let n = 0;
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) if ((dx || dy) && getCell(g, x + dx + 64, y + dy + 64)) n++;
    const next = getCell(g, x, y) ? (s >> n) & 1 : (b >> n) & 1;
    if (next) o[y] |= 1n << BigInt(x);
  }
  return o;
}

describe("sim engine", () => {
  it("matches naive reference for random rules", () => {
    const r = new Rng(7);
    for (let k = 0; k < 10; k++) {
      const g = emptyGrid();
      for (let i = 0; i < 64; i++) g[i] = r.big64() & r.big64();
      const b = (r.int(512) & ~1) | 8, s = r.int(512);
      expect(step(g, b, s)).toEqual(naive(g, b, s));
    }
  });
  it("glider travels and wraps", () => {
    const g = emptyGrid();
    writeBlock(g, 0, GLIDER);
    const after = stepN(g, LIFE.birth, LIFE.survive, 64 * 4);
    expect(population(after)).toBe(5);
    expect(after).toEqual(g); // period 4, speed c/4 → 256 gens = full lap on 64 torus
  });
  it("counts sum to population, blocks are local", () => {
    const g = bigbang(new Uint8Array(32).fill(9));
    expect(territoryCounts(g).reduce((a, b) => a + b, 0)).toBe(population(g));
    writeBlock(g, 10, 0n);
    expect(territoryCounts(g)[10]).toBe(0);
    orBlock(g, 10, GLIDER);
    expect(territoryCounts(g)[10]).toBe(5);
  });
  it("bigbang density ~25%", () => {
    const pop = population(bigbang(new Uint8Array(32)));
    expect(pop).toBeGreaterThan(800);
    expect(pop).toBeLessThan(1250);
  });
  it("shared vectors are up to date", () => {
    const v = JSON.parse(readFileSync(new URL("../../../tests/vectors/sim.json", import.meta.url), "utf8"));
    for (const c of v.cases) {
      const input = BigUint64Array.from(c.input.map((h: string) => BigInt("0x" + h)));
      const out = stepN(input, c.birth, c.survive, c.gens);
      expect(Array.from(out, (x) => x.toString(16))).toEqual(c.output);
    }
  });
});

describe("fast engine == BigInt reference", () => {
  it("random grids & rules", async () => {
    const { stepBig } = await import("../src/sim.js");
    const r = new Rng(123);
    for (let k = 0; k < 50; k++) {
      const g = emptyGrid();
      for (let i = 0; i < 64; i++) g[i] = r.big64() & (r.next() < 0.5 ? r.big64() : ~0n & ((1n << 64n) - 1n));
      const b = (r.int(512) & ~1) | 4, s = r.int(512);
      expect(step(g, b, s)).toEqual(stepBig(g, b, s));
    }
  });
});
