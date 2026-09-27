// "Лаборатория физики": player-authored (quantum) laws of physics.
//
// Everything here is client-side tooling around the on-chain `register_module`
// instruction: the contract is the authority (validate_rule +
// validate_quantum_rule + MAX_ROYALTY_BPS); `lawError` mirrors it exactly so
// the UI never builds a transaction the program would reject (#61, #62).
import { MAX_ROYALTY_BPS } from "./constants.js";
import { bigbang, population, RULE_MASK, stepNQ, type Quantum } from "./sim.js";
import { quantumRuleError, MAX_Q_AMP } from "./quantum.js";
import type { GameModel } from "./model.js";

export interface Law {
  birth: number; survive: number; qBirth: number; qSurvive: number; qAmp: number; royaltyBps: number;
}

const bits = (m: number) => { const out: number[] = []; for (let i = 0; i <= 8; i++) if ((m >> i) & 1) out.push(i); return out; };
export const maskOf = (...n: number[]) => n.reduce((a, k) => a | (1 << k), 0);

/** Mirror of the on-chain checks. Returns a Russian error message or null. */
export function lawError(l: Law): string | null {
  for (const [k, v] of Object.entries({ birth: l.birth, survive: l.survive, qBirth: l.qBirth, qSurvive: l.qSurvive })) {
    if (!Number.isInteger(v) || v < 0 || (v & ~RULE_MASK) !== 0) return `маска ${k} вне диапазона 0–8 соседей`;
  }
  if (l.birth & 1) return "B0 запрещено: клетки рождались бы из пустоты повсюду";
  if (l.birth === 0) return "нужно хотя бы одно правило рождения";
  if (!Number.isInteger(l.qAmp) || l.qAmp < 0 || l.qAmp > MAX_Q_AMP) return `амплитуда 0–${MAX_Q_AMP}`;
  const q = quantumRuleError(l.birth, l.survive, l.qBirth, l.qSurvive, l.qAmp);
  if (q) {
    const ru: Record<string, string> = {
      "quantum B0 forbidden": "квантовое B0 запрещено",
      "quantum masks overlap the classical rule": "квантовые маски не должны пересекаться с классическими",
      "amp=0 iff no quantum masks": "амплитуда > 0 ⇔ есть квантовые маски",
    };
    return ru[q] ?? q;
  }
  if (!Number.isInteger(l.royaltyBps) || l.royaltyBps < 0 || l.royaltyBps > MAX_ROYALTY_BPS) return `роялти 0–${MAX_ROYALTY_BPS / 100}%`;
  return null;
}

/** "B36/S23 ⚛qB6·qS4 p=¼" */
export function lawString(l: Pick<Law, "birth" | "survive" | "qBirth" | "qSurvive" | "qAmp">): string {
  const base = `B${bits(l.birth).join("")}/S${bits(l.survive).join("")}`;
  if (!l.qAmp) return base;
  const q = [l.qBirth ? `qB${bits(l.qBirth).join("")}` : "", l.qSurvive ? `qS${bits(l.qSurvive).join("")}` : ""].filter(Boolean).join("·");
  return `${base} ⚛${q} p=${["1", "½", "¼", "⅛"][l.qAmp]}`;
}

/** Parse "B3/S23" or "B36/S23/qB6/qS4/a2" (case-insensitive). Returns null when malformed. */
export function parseLaw(s: string): Omit<Law, "royaltyBps"> | null {
  const out = { birth: 0, survive: 0, qBirth: 0, qSurvive: 0, qAmp: 0 };
  const parts = s.trim().toUpperCase().split(/[/\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const m = /^(QB|QS|B|S|A)([0-8]*)$/.exec(p);
    if (!m) return null;
    const digits = [...m[2]].map(Number);
    if (m[1] === "A") { if (digits.length !== 1) return null; out.qAmp = digits[0]; continue; }
    const mask = maskOf(...digits);
    if (m[1] === "B") out.birth = mask; else if (m[1] === "S") out.survive = mask;
    else if (m[1] === "QB") out.qBirth = mask; else out.qSurvive = mask;
  }
  return out;
}

export type Verdict = "вымирание" | "стазис" | "жизнь" | "хаос" | "взрыв";
export interface LawProbe {
  /** population per generation, averaged over universes (fraction of 4096 cells) */
  curve: number[];
  finalDensity: number;
  /** relative activity in the second half (mean |Δpop| / pop) */
  activity: number;
  verdict: Verdict;
  /** 0..100: how "alive" the physics is — the AI market prices laws by it */
  vitality: number;
}

/**
 * Deterministic preview of a law: `universes` big-bang grids evolved for
 * `gens` generations. Quantum laws use pseudo-random (preview-only) seeds —
 * the real future depends on SlotHashes, so this is a forecast, not a promise.
 */
export function probeLaw(l: Omit<Law, "royaltyBps">, gens = 96, universes = 3, salt = 1): LawProbe {
  const curve = new Array<number>(gens + 1).fill(0);
  const quantum = l.qAmp > 0 && (l.qBirth | l.qSurvive) !== 0;
  for (let u = 0; u < universes; u++) {
    const key = new Uint8Array(32); key[0] = u; key[1] = salt & 0xff; key[2] = (salt >> 8) & 0xff; key[3] = 0x1a;
    let g = bigbang(key);
    const q: Quantum | null = quantum
      ? { qBirth: l.qBirth, qSurvive: l.qSurvive, amp: l.qAmp, seed: [BigInt(u + 1), BigInt(salt), 0x5eedn, 0x1abn] }
      : null;
    curve[0] += population(g);
    for (let i = 1; i <= gens; i++) {
      g = stepNQ(g, l.birth, l.survive, q, BigInt(i - 1), 1);
      curve[i] += population(g);
    }
  }
  const norm = curve.map((v) => v / universes / 4096);
  const half = norm.slice(Math.floor(gens / 2));
  const finalDensity = norm[gens];
  let delta = 0;
  for (let i = 1; i < half.length; i++) delta += Math.abs(half[i] - half[i - 1]);
  const meanHalf = half.reduce((a, b) => a + b, 0) / half.length;
  const activity = meanHalf > 0 ? delta / (half.length - 1) / meanHalf : 0;
  let verdict: Verdict;
  if (finalDensity < 0.005) verdict = "вымирание";
  else if (finalDensity > 0.6) verdict = "взрыв";
  else if (finalDensity > 0.4 && activity > 0.05) verdict = "хаос";
  else if (activity < 0.002) verdict = "стазис";
  else verdict = "жизнь";
  // vitality: density near a lively band (5–35%) × some ongoing activity
  const band = finalDensity <= 0 ? 0 : finalDensity < 0.05 ? finalDensity / 0.05 : finalDensity <= 0.35 ? 1 : Math.max(0, 1 - (finalDensity - 0.35) / 0.35);
  const act = Math.min(1, activity / 0.02);
  const vitality = Math.round(100 * band * (0.35 + 0.65 * act));
  return { curve: norm, finalDensity, activity, verdict, vitality };
}

/** Tiny deterministic RNG interface (agents' Rng satisfies it). */
export interface RngLike { next(): number; int(n: number): number }

/**
 * Mutate a law by flipping one random bit of B/S/qB/qS (or nudging amp) and
 * repairing it into a valid law. Used by the AI "physicist".
 */
export function mutateLaw(l: Law, rng: RngLike, tries = 32): Law {
  for (let t = 0; t < tries; t++) {
    const n = { ...l };
    const which = rng.int(5);
    const bit = 1 << rng.int(9);
    if (which === 0) n.birth ^= bit;
    else if (which === 1) n.survive ^= bit;
    else if (which === 2) n.qBirth ^= bit;
    else if (which === 3) n.qSurvive ^= bit;
    else n.qAmp = Math.max(0, Math.min(MAX_Q_AMP, n.qAmp + (rng.next() < 0.5 ? -1 : 1)));
    // repair: quantum masks never overlap classical ones, no B0
    n.birth &= ~1;
    n.qBirth &= ~n.birth & ~1;
    n.qSurvive &= ~n.survive;
    if ((n.qBirth | n.qSurvive) === 0) n.qAmp = 0;
    else if (n.qAmp === 0) n.qAmp = 1;
    if (!lawError(n) && (n.birth !== l.birth || n.survive !== l.survive || n.qBirth !== l.qBirth || n.qSurvive !== l.qSurvive || n.qAmp !== l.qAmp)) return n;
  }
  return l;
}

/**
 * Live vitality of a registered module: mean density of the worlds that run
 * it, blended with the offline probe (so new laws still get a score).
 */
export function moduleVitality(m: GameModel, moduleId: number, cache?: Map<number, number>): number {
  const mod = m.modules[moduleId];
  if (!mod) return 0;
  let probe = cache?.get(moduleId);
  if (probe === undefined) { probe = probeLaw(mod, 48, 2).vitality; cache?.set(moduleId, probe); }
  const worlds = [...m.worlds.values()].filter((w) => w.module === moduleId);
  if (!worlds.length) return probe;
  const live = worlds.reduce((a, w) => {
    const d = population(w.grid) / 4096;
    return a + (d < 0.05 ? d / 0.05 : d <= 0.35 ? 1 : Math.max(0, 1 - (d - 0.35) / 0.35));
  }, 0) / worlds.length * 100;
  return Math.round(0.5 * probe + 0.5 * live);
}

/** Weighted pick of a module id by vitality² (AI demiurges choose physics like investors). */
export function pickModuleByVitality(m: GameModel, rng: RngLike, filter: (id: number) => boolean = () => true, cache?: Map<number, number>): number | null {
  const ids = m.modules.map((x) => x.id).filter(filter);
  if (!ids.length) return null;
  const w = ids.map((id) => { const v = moduleVitality(m, id, cache) + 1; return v * v; });
  let r = rng.next() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
  return ids[ids.length - 1];
}
