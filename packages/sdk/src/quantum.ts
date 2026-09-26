// Mirror of programs/recursia/src/quantum.rs (pure functions).
import { sha256 } from "@noble/hashes/sha256";
import type { Quantum } from "./sim.js";

export const MAX_Q_AMP = 3;
export const QUANTUM_DELAY_SLOTS = 32;
export const QUANTUM_REVEAL_SLOTS = 21_600;
export const QUANTUM_STAKE_MULT = 4n;
export const QUANTUM_BOUNTY_DIV = 20n;
export const QUANTUM_REARM_BURN_BPS = 2_500n;
export const TUNNEL_CHANCE_256 = 16;
export const SLOT_HASHES_MAX = 512;

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u64le = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const u16le = (v: number) => Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
/** Solana `hashv` = sha256 over the concatenation. */
export const hashv = (...parts: Uint8Array[]) => sha256(cat(...parts));

export type SlotHashLookup =
  | { kind: "found"; slot: bigint; hash: Uint8Array }
  | { kind: "expired"; oldest: Uint8Array }
  | { kind: "notYet"; newest: Uint8Array };

/** Parse raw SlotHashes sysvar data (descending) — smallest slot ≥ target. */
export function slotHashLookup(data: Uint8Array, targetSlot: bigint | number): SlotHashLookup | null {
  const target = BigInt(targetSlot);
  if (data.length < 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = Math.min(Number(dv.getBigUint64(0, true)), SLOT_HASHES_MAX);
  if (len === 0) return null;
  const entry = (i: number) => {
    const off = 8 + i * 40;
    if (off + 40 > data.length) return null;
    return { slot: dv.getBigUint64(off, true), hash: data.slice(off + 8, off + 40) };
  };
  const e0 = entry(0); const el = entry(len - 1);
  if (!e0 || !el) return null;
  if (e0.slot < target) return { kind: "notYet", newest: e0.hash };
  if (el.slot >= target) {
    return el.slot === target || len < SLOT_HASHES_MAX ? { kind: "found", slot: el.slot, hash: el.hash } : { kind: "expired", oldest: el.hash };
  }
  let lo = 0, hi = len - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const e = entry(mid); if (!e) return null;
    if (e.slot >= target) lo = mid; else hi = mid;
  }
  const e = entry(lo)!;
  return { kind: "found", slot: e.slot, hash: e.hash };
}

export function quantumSeed(slotHash: Uint8Array, world: Uint8Array, generation: bigint): bigint[] {
  const d = hashv(enc.encode("recursia:q"), slotHash, world, u64le(generation));
  const dv = new DataView(d.buffer, d.byteOffset, 32);
  return [0, 1, 2, 3].map((k) => dv.getBigUint64(k * 8, true));
}

export const makeQuantum = (qBirth: number, qSurvive: number, amp: number, seed: bigint[]): Quantum => ({ qBirth, qSurvive, amp, seed });

export function commitment(a: bigint, b: bigint, weightBps: number, salt: Uint8Array, owner: Uint8Array, world: Uint8Array, index: number): Uint8Array {
  if (salt.length !== 32 || owner.length !== 32 || world.length !== 32) throw new Error("salt/owner/world must be 32 bytes");
  return hashv(enc.encode("recursia:psi"), u64le(a), u64le(b), u16le(weightBps), salt, owner, world, Uint8Array.of(index));
}

export interface Collapse { branchA: boolean; tunnel: boolean; tunnelDir: number }

export function collapse(entropy: Uint8Array, commit: Uint8Array, weightBps: number): Collapse {
  const r = hashv(enc.encode("recursia:collapse"), entropy, commit);
  const roll = (r[0] | (r[1] << 8) | (r[2] << 16) | (r[3] << 24)) >>> 0;
  return { branchA: roll % 10_000 < weightBps, tunnel: r[4] < TUNNEL_CHANCE_256, tunnelDir: r[5] & 3 };
}

export function neighbour(idx: number, dir: number): number {
  const x = idx % 8, y = Math.floor(idx / 8);
  const [nx, ny] = [[x, (y + 7) % 8], [(x + 1) % 8, y], [x, (y + 1) % 8], [(x + 7) % 8, y]][dir & 3];
  return ny * 8 + nx;
}

/** Validation mirror of `validate_quantum_rule`. Returns an error string or null. */
export function quantumRuleError(birth: number, survive: number, qBirth: number, qSurvive: number, amp: number): string | null {
  if ((qBirth | qSurvive) & ~0x1ff) return "mask out of range";
  if (qBirth & 1) return "quantum B0 forbidden";
  if ((qBirth & birth) || (qSurvive & survive)) return "quantum masks overlap the classical rule";
  if (amp < 0 || amp > MAX_Q_AMP) return "amp must be 0..3";
  if ((amp === 0) !== ((qBirth | qSurvive) === 0)) return "amp=0 iff no quantum masks";
  return null;
}

/** Random 32-byte salt (browser/node crypto). */
export function randomSalt(): Uint8Array {
  const s = new Uint8Array(32);
  globalThis.crypto.getRandomValues(s);
  return s;
}
