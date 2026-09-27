/**
 * Onboarding: the "first steps" quest and the mentor.
 *
 * The mentor is deliberately NOT a language model: it is a set of rules over
 * the public game state. Nothing to prompt-inject, no external calls, no keys
 * and it never acts on its own — it only points at a cell and explains why
 * (checklist: AI agents, limits in the contract, not in a prompt). Every number
 * it quotes is computed by the same deterministic simulation / formulas as the
 * program.
 */
import { PATTERNS, epochTax, isQuantum, type GameModel, type MWorld } from "@recursia/sdk";
import { plantForecast } from "./advice";

export const PATTERN_LABEL: Record<string, string> = { glider: "глайдер", lwss: "корабль", rpentomino: "R-пентамино", block: "блок", acorn: "жёлудь", beacon: "маяк" };

/** Horizons the pattern must survive — short (the next epoch's score) and long. */
const SAFE_GENS = [16, 48] as const;

export interface SafePattern { name: string; label: string; pattern: bigint; alive: number }

/**
 * The pattern that stays alive on this exact cell, checked by the deterministic
 * simulation for 16 and 48 generations (for quantum worlds: in every sampled
 * future). In a classical world this is a guarantee as long as the neighbours
 * don't change; null if nothing survives here.
 */
export function safestPattern(world: MWorld, idx: number): SafePattern | null {
  let best: SafePattern | null = null;
  // the still-life "block" first: it survives on any quiet cell and is the cheapest to reason about
  const order = ["block", "beacon", ...Object.keys(PATTERNS).filter((k) => k !== "block" && k !== "beacon")];
  for (const name of order) {
    const pattern = PATTERNS[name];
    if (pattern === undefined) continue;
    const alive = Math.min(...SAFE_GENS.map((g) => plantForecast(world, idx, pattern, g).lo));
    if (alive > 0 && (!best || alive > best.alive)) best = { name, label: PATTERN_LABEL[name] ?? name, pattern, alive };
    if (best && name === "block") return best; // good enough and the most predictable
  }
  return best;
}

/** Per-epoch income estimate of a cell: its share of last epoch's owned live score × the world's pool contribution. */
export function cellYield(w: MWorld, idx: number): bigint {
  let total = 0n;
  w.territories.forEach((t, i) => { if (t.holder || i === idx) total += BigInt(w.scoresPrev[i]); });
  return total === 0n ? 0n : (w.sinkPrev * BigInt(w.scoresPrev[idx])) / total;
}

export interface Pick { world: string; idx: number }

/** A free cell in a classical world where a verified pattern survives — the tutorial's first plot. */
export function recommendFirstCell(m: GameModel, limit = 24): (Pick & { safe: SafePattern; price: bigint }) | null {
  const worlds = [...m.worlds.values()].filter((w) => !w.neutral && !isQuantum(w) && w.energy > 0n);
  let best: (Pick & { safe: SafePattern; price: bigint; score: number }) | null = null;
  for (const w of worlds) {
    let checked = 0;
    for (let i = 0; i < w.territories.length && checked < limit; i++) {
      if (w.territories[i].holder || w.territories[i].childWorld) continue;
      checked++;
      const safe = safestPattern(w, i);
      if (!safe) continue;
      const score = safe.alive * 1_000 + Number(cellYield(w, i) % 1_000_000n);
      if (!best || score > best.score) best = { world: w.id, idx: i, safe, price: m.quote(w.id, i).price, score };
    }
    if (best) break; // the first living classical world is enough for a first plot
  }
  return best && { world: best.world, idx: best.idx, safe: best.safe, price: best.price };
}

// ------------------------------------------------------------------ quest

export type StepId = "acquire" | "plant" | "earn" | "collect";
export interface Step { id: StepId; title: string; hint: string; done: boolean }

/**
 * Current state of each step. `latched` = steps already completed earlier
 * (kept by the caller in localStorage) — a step never "un-completes".
 */
export function tutorialSteps(m: GameModel, you: string, latched: ReadonlySet<StepId> = new Set()): Step[] {
  const mine: { w: MWorld; i: number }[] = [];
  for (const w of m.worlds.values()) w.territories.forEach((t, i) => { if (t.holder === you) mine.push({ w, i }); });
  const p = m.players.get(you);
  const done: Record<StepId, boolean> = {
    acquire: mine.length > 0,
    // a running plant cooldown = planted recently (the caller latches it)
    plant: mine.some(({ w, i }) => w.territories[i].nextPlantTick > w.tickCount && w.alive[i] > 0),
    earn: mine.some(({ w, i }) => w.pending[i] > 0n),
    collect: (p?.totalEarned ?? 0n) > 0n,
  };
  const steps: Omit<Step, "done">[] = [
    { id: "acquire", title: "Займите клетку", hint: "Свободная клетка стоит минимальную цену; вы сами назначаете свою цену и платите с неё налог. Дороже цена — труднее у вас выкупить." },
    { id: "plant", title: "Посадите живой паттерн", hint: "Наставник выберет паттерн, который, по той же симуляции, что в контракте, выживет на вашей клетке 48 поколений." },
    { id: "earn", title: "Дождитесь дохода", hint: "Каждый тик живые клетки на вашей земле набирают очки; в конце эпохи мир делит награды по очкам. Ускорьте время кнопками ×5 / ×10." },
    { id: "collect", title: "Соберите первые SKR", hint: "Награды копятся на клетке. «Собрать» переводит их на ваш баланс; сначала из них гасится налог." },
  ];
  // steps complete in order: a later condition can't count before the earlier ones
  let prevDone = true;
  return steps.map((s) => {
    const d = latched.has(s.id) || (prevDone && done[s.id]);
    prevDone = d;
    return { ...s, done: d };
  });
}

// ------------------------------------------------------------------ mentor

export type TipLevel = "danger" | "warn" | "tip" | "ok";
export interface Tip { level: TipLevel; text: string; at?: Pick }

const ORDER: Record<TipLevel, number> = { danger: 0, warn: 1, tip: 2, ok: 3 };

/**
 * Up to `max` most important things to do now, most urgent first.
 * @param fmt money formatter of the host view
 * @param secrets keys "world:index" of superpositions whose secret is on this device
 */
export function mentorTips(m: GameModel, you: string, fmt: (v: bigint) => string, secrets: ReadonlySet<string> = new Set(), max = 3): Tip[] {
  const tips: Tip[] = [];
  const p = m.params;
  const epochSlots = Number(p.epochSlots);

  // 1. stakes about to burn: observed superposition, reveal window closing
  for (const sp of m.superpositions.values()) {
    if (sp.owner !== you || !sp.observed) continue;
    const left = sp.revealDeadline - m.slot;
    const at = { world: sp.world, idx: sp.index };
    if (!secrets.has(`${sp.world}:${sp.index}`)) tips.push({ level: "danger", text: `Суперпозиция на клетке #${sp.index} измерена, а секрета на этом устройстве нет: без импорта секрета залог ${fmt(sp.stake)} сгорит.`, at });
    else if (left < epochSlots / 4) tips.push({ level: "danger", text: `Раскройте суперпозицию на клетке #${sp.index}: осталось ${left} слотов, иначе залог ${fmt(sp.stake)} уйдёт в пул.`, at });
  }

  for (const w of m.worlds.values()) {
    w.territories.forEach((t, i) => {
      if (t.holder !== you) return;
      const at = { world: w.id, idx: i };
      const tax = epochTax(t.price, p.harbergerBps);
      // 2. deposit runs out → foreclosure: the cell is lost
      if (tax > 0n && t.deposit < tax) tips.push({ level: "danger", text: `Депозита на клетке #${i} («${w.name}») меньше, чем на эпоху налога (${fmt(t.deposit)} < ${fmt(tax)}): пополните его или снизьте цену, иначе клетку изымут.`, at });
      // 3. empty land: tax without income
      if (w.alive[i] === 0 && !t.childWorld) {
        const safe = safestPattern(w, i);
        tips.push({ level: "warn", text: safe
          ? `Клетка #${i} («${w.name}») пустая: налог идёт, дохода нет. Посадите «${safe.label}» — по симуляции выживет (${safe.alive} живых через 48 поколений).`
          : `Клетка #${i} («${w.name}») пустая, и здесь ничего не выживает из-за соседей: снизьте цену до минимума, чтобы не платить лишний налог, или продайте её.`, at });
      }
      // 4. rewards waiting
      if (w.pending[i] >= p.plantCost / 10n && w.pending[i] > 0n) tips.push({ level: "ok", text: `На клетке #${i} («${w.name}») ждут ${fmt(w.pending[i])} — соберите их.`, at });
      // 5. overpriced: paying tax for protection nobody threatens
      const y = cellYield(w, i);
      if (t.price > p.minPrice * 4n && y * 3n < tax) tips.push({ level: "tip", text: `Цена клетки #${i} (${fmt(t.price)}) высока для её дохода (~${fmt(y)} за эпоху при налоге ${fmt(tax)}): снижение цены сэкономит налог.`, at });
    });
  }

  // 6. opportunity: cheap land with proven income (only if the player can afford it)
  const wallet = m.players.get(you)?.wallet ?? 0n;
  let best: { at: Pick; price: bigint; y: bigint; name: string } | null = null;
  for (const w of m.worlds.values()) {
    w.territories.forEach((t, i) => {
      if (t.holder === you || t.childWorld) return;
      const price = m.quote(w.id, i).price;
      const y = cellYield(w, i);
      if (y === 0n || price + epochTax(price, p.harbergerBps) * 3n > wallet) return;
      if (!best || y * best.price > best.y * price) best = { at: { world: w.id, idx: i }, price, y, name: w.name };
    });
  }
  if (best) {
    const b = best as { at: Pick; price: bigint; y: bigint; name: string };
    const payback = Number((b.price + b.y - 1n) / b.y);
    if (payback <= 6) tips.push({ level: "tip", text: `Клетка #${b.at.idx} в «${b.name}»: доход ~${fmt(b.y)} за прошлую эпоху при цене ${fmt(b.price)} — окупится примерно за ${payback} эп.`, at: b.at });
  }

  return tips.sort((a, b) => ORDER[a.level] - ORDER[b.level]).slice(0, max);
}
