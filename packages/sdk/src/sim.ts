import { Buffer } from "buffer";
// Bit-for-bit mirror of programs/recursia/src/sim.rs.
import { sha256 } from "@noble/hashes/sha256";
import { GRID, TERRITORIES } from "./constants.js";

export type Grid = BigUint64Array; // 64 rows, bit x of row y = cell (x, y)
const M64 = (1n << 64n) - 1n;
export const RULE_MASK = 0x1ff;
export const GLIDER = 0x0000_0000_0007_0402n;

export const emptyGrid = (): Grid => new BigUint64Array(GRID);

const rotl = (v: bigint) => ((v << 1n) | (v >> 63n)) & M64;
const rotr = (v: bigint) => ((v >> 1n) | ((v & 1n) << 63n)) & M64;

// Hot loop on (lo, hi) uint32 halves — ~50x faster than BigInt, identical bits.
function toHalves(g: Grid): Uint32Array {
  const h = new Uint32Array(GRID * 2);
  for (let y = 0; y < GRID; y++) { h[2 * y] = Number(g[y] & 0xffffffffn); h[2 * y + 1] = Number(g[y] >> 32n); }
  return h;
}
function fromHalves(h: Uint32Array): Grid {
  const g = new BigUint64Array(GRID);
  for (let y = 0; y < GRID; y++) g[y] = (BigInt(h[2 * y + 1]) << 32n) | BigInt(h[2 * y]);
  return g;
}

function stepHalves(src: Uint32Array, dst: Uint32Array, birth: number, survive: number): void {
  for (let y = 0; y < GRID; y++) {
    const yu = (y + GRID - 1) % GRID, yd = (y + 1) % GRID;
    for (let o = 0; o < 2; o++) {
      const x = 1 - o;
      const uL = src[2 * yu + o], uO = src[2 * yu + x];
      const mL = src[2 * y + o], mO = src[2 * y + x];
      const dL = src[2 * yd + o], dO = src[2 * yd + x];
      // 8 neighbour planes; rotation carries bits across the two halves (torus wrap)
      const n0 = (uL << 1) | (uO >>> 31), n1 = uL, n2 = (uL >>> 1) | (uO << 31);
      const n3 = (mL << 1) | (mO >>> 31), n4 = (mL >>> 1) | (mO << 31);
      const n5 = (dL << 1) | (dO >>> 31), n6 = dL, n7 = (dL >>> 1) | (dO << 31);
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c0 = 0, c1 = 0, c2 = 0;
      c0 = s0 & n0; s0 ^= n0; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n1; s0 ^= n1; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n2; s0 ^= n2; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n3; s0 ^= n3; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n4; s0 ^= n4; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n5; s0 ^= n5; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n6; s0 ^= n6; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      c0 = s0 & n7; s0 ^= n7; c1 = s1 & c0; s1 ^= c0; c2 = s2 & c1; s2 ^= c1; s3 |= c2;
      let born = 0, keep = 0;
      for (let n = 0; n < 9; n++) {
        const bn = (birth >> n) & 1, sn = (survive >> n) & 1;
        if (!bn && !sn) continue;
        const eq = (n & 1 ? s0 : ~s0) & (n & 2 ? s1 : ~s1) & (n & 4 ? s2 : ~s2) & (n & 8 ? s3 : ~s3);
        if (bn) born |= eq;
        if (sn) keep |= eq;
      }
      dst[2 * y + o] = ((mL & keep) | (~mL & born)) >>> 0;
    }
  }
}

export function step(grid: Grid, birth: number, survive: number): Grid {
  return stepN(grid, birth, survive, 1);
}

export function stepN(grid: Grid, birth: number, survive: number, gens: number): Grid {
  birth &= RULE_MASK;
  survive &= RULE_MASK;
  let a = toHalves(grid), b = new Uint32Array(GRID * 2);
  for (let i = 0; i < gens; i++) { stepHalves(a, b, birth, survive); const t = a; a = b; b = t; }
  return fromHalves(a);
}

/** Reference BigInt implementation (kept for cross-checking in tests). */
export function stepBig(grid: Grid, birth: number, survive: number): Grid {
  birth &= RULE_MASK;
  survive &= RULE_MASK;
  const out = new BigUint64Array(GRID);
  for (let y = 0; y < GRID; y++) {
    const up = grid[(y + GRID - 1) % GRID];
    const mid = grid[y];
    const down = grid[(y + 1) % GRID];
    let s0 = 0n, s1 = 0n, s2 = 0n, s3 = 0n;
    const add = (a: bigint) => {
      const c0 = s0 & a; s0 ^= a;
      const c1 = s1 & c0; s1 ^= c0;
      const c2 = s2 & c1; s2 ^= c1;
      s3 |= c2;
    };
    add(rotl(up)); add(up); add(rotr(up));
    add(rotl(mid)); add(rotr(mid));
    add(rotl(down)); add(down); add(rotr(down));
    let born = 0n, keep = 0n;
    for (let n = 0; n < 9; n++) {
      const bn = (birth >> n) & 1, sn = (survive >> n) & 1;
      if (!bn && !sn) continue;
      const pick = (bit: number, p: bigint) => ((n >> bit) & 1 ? p : ~p & M64);
      const eq = pick(0, s0) & pick(1, s1) & pick(2, s2) & pick(3, s3);
      if (bn) born |= eq;
      if (sn) keep |= eq;
    }
    out[y] = ((mid & keep) | (~mid & M64 & born)) & M64;
  }
  return out;
}

function popcount64(v: bigint): number {
  let lo = Number(v & 0xffffffffn), hi = Number(v >> 32n);
  const pc = (x: number) => {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  return pc(lo) + pc(hi);
}

const pc32 = (x: number) => {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

function countsFromHalves(h: Uint32Array): number[] {
  const c = new Array<number>(TERRITORIES).fill(0);
  for (let y = 0; y < GRID; y++) {
    const base = (y >> 3) * 8;
    const lo = h[2 * y], hi = h[2 * y + 1];
    c[base] += pc32(lo & 0xff); c[base + 1] += pc32((lo >>> 8) & 0xff); c[base + 2] += pc32((lo >>> 16) & 0xff); c[base + 3] += pc32(lo >>> 24);
    c[base + 4] += pc32(hi & 0xff); c[base + 5] += pc32((hi >>> 8) & 0xff); c[base + 6] += pc32((hi >>> 16) & 0xff); c[base + 7] += pc32(hi >>> 24);
  }
  return c;
}

export function territoryCounts(grid: Grid): number[] {
  return countsFromHalves(toHalves(grid));
}

function blockCountHalves(h: Uint32Array, idx: number): number {
  const tx = idx % 8, ty = idx >> 3;
  const word = tx < 4 ? 0 : 1, sh = (tx % 4) * 8;
  let c = 0;
  for (let r = 0; r < 8; r++) c += pc32((h[2 * (ty * 8 + r) + word] >>> sh) & 0xff);
  return c;
}

/**
 * Planner primitive for AI agents: write `pattern` into block `idx`, run
 * `gens` generations and return the sum of live cells in that block sampled
 * every `every` generations. Runs entirely in the fast uint32 domain.
 */
export function scoreBlockPattern(grid: Grid, birth: number, survive: number, idx: number, pattern: bigint, gens = 8, every = 2): number {
  const g = grid.slice();
  writeBlock(g, idx, pattern);
  let a = toHalves(g), b = new Uint32Array(GRID * 2);
  let score = 0;
  for (let i = 1; i <= gens; i++) {
    stepHalves(a, b, birth & RULE_MASK, survive & RULE_MASK);
    const t = a; a = b; b = t;
    if (i % every === 0) score += blockCountHalves(a, idx);
  }
  return score;
}

export const population = (g: Grid) => g.reduce((a, r) => a + popcount64(r), 0);

export function writeBlock(grid: Grid, idx: number, pattern: bigint): void {
  idx %= TERRITORIES;
  const shift = BigInt((idx % 8) * 8);
  const ty = Math.floor(idx / 8);
  const clear = ~(0xffn << shift) & M64;
  for (let r = 0; r < 8; r++) {
    const y = ty * 8 + r;
    const byte = (pattern >> BigInt(r * 8)) & 0xffn;
    grid[y] = (grid[y] & clear) | (byte << shift);
  }
}

export function orBlock(grid: Grid, idx: number, pattern: bigint): void {
  idx %= TERRITORIES;
  const shift = BigInt((idx % 8) * 8);
  const ty = Math.floor(idx / 8);
  for (let r = 0; r < 8; r++) {
    const y = ty * 8 + r;
    grid[y] |= ((pattern >> BigInt(r * 8)) & 0xffn) << shift;
  }
}

export function blockPattern(grid: Grid, idx: number): bigint {
  const shift = BigInt((idx % 8) * 8);
  const ty = Math.floor(idx / 8);
  let p = 0n;
  for (let r = 0; r < 8; r++) p |= ((grid[ty * 8 + r] >> shift) & 0xffn) << BigInt(r * 8);
  return p;
}

export const getCell = (g: Grid, x: number, y: number) => ((g[y & 63] >> BigInt(x & 63)) & 1n) === 1n;

export function toBytes(grid: Grid): Uint8Array {
  const out = new Uint8Array(GRID * 8);
  const dv = new DataView(out.buffer);
  grid.forEach((r, i) => dv.setBigUint64(i * 8, r, true));
  return out;
}

export function stateHash(grid: Grid): string {
  return Buffer.from(sha256(toBytes(grid))).toString("hex");
}

/** Same derivation as `world::bigbang` on-chain (sha256 = Solana hashv). */
export function bigbang(worldKey: Uint8Array): Grid {
  const cat = (...parts: Uint8Array[]) => {
    const n = parts.reduce((a, p) => a + p.length, 0);
    const o = new Uint8Array(n);
    let off = 0;
    for (const p of parts) { o.set(p, off); off += p.length; }
    return o;
  };
  const seed = sha256(cat(new TextEncoder().encode("recursia:bigbang"), worldKey));
  const a = new BigUint64Array(GRID), b = new BigUint64Array(GRID);
  for (let i = 0; i < 32; i++) {
    const d = sha256(cat(seed, Uint8Array.of(i)));
    const dv = new DataView(d.buffer, d.byteOffset, 32);
    for (let j = 0; j < 4; j++) {
      const slot = i * 4 + j;
      const v = dv.getBigUint64(j * 8, true);
      if (slot < GRID) a[slot] = v; else b[slot - GRID] = v;
    }
  }
  const g = new BigUint64Array(GRID);
  for (let y = 0; y < GRID; y++) g[y] = a[y] & b[y];
  return g;
}

/** Pattern helpers for the planting editor (8x8 block <-> bigint). */
export function patternFromCells(cells: boolean[][]): bigint {
  let p = 0n;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (cells[r]?.[c]) p |= 1n << BigInt(r * 8 + c);
  return p;
}
export function cellsFromPattern(p: bigint): boolean[][] {
  return [...Array(8)].map((_, r) => [...Array(8)].map((_, c) => ((p >> BigInt(r * 8 + c)) & 1n) === 1n));
}

export const PATTERNS: Record<string, bigint> = {
  glider: GLIDER,
  lwss: patternFromCells([
    [false, true, false, false, true],
    [true, false, false, false, false],
    [true, false, false, false, true],
    [true, true, true, true, false],
  ]),
  rpentomino: patternFromCells([[false, true, true], [true, true, false], [false, true, false]].map((r) => [false, false, false, ...r])),
  block: patternFromCells([[], [], [], [false, false, false, true, true], [false, false, false, true, true]]),
  acorn: patternFromCells([[], [], [false, true], [false, false, false, true], [true, true, false, false, true, true, true]]),
  beacon: patternFromCells([[], [true, true], [true, true], [false, false, true, true], [false, false, true, true]]),
};
