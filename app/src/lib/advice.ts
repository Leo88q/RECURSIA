/**
 * Planting advice shown before a player spends plant_cost.
 *
 * The econ simulation shows that newcomers lose most of their money on
 * plantings that die (every dead planting loses at least the studio's 20%,
 * and no efficiency share is paid for dead cells). The client runs the same
 * deterministic simulation as the program, so it can warn before the spend.
 * This is advice only; the contract never blocks a planting (limits that
 * matter live in the program, not in the UI — checklist #69).
 */
export type AdviceLevel = "ok" | "warn" | "danger";
export interface PlantAdvice { level: AdviceLevel; text: string }

/**
 * @param lo,hi forecast of live cells in the block after 16 generations (lo = hi in classical worlds)
 * @param aliveNow live cells in the block right now
 */
export function plantAdvice(lo: number, hi: number, aliveNow: number): PlantAdvice {
  if (hi === 0) return { level: "danger", text: "Эта посадка вымрет за 16 поколений: плата за посадку не вернётся. Попробуйте другой паттерн." };
  if (hi <= aliveNow) return { level: "warn", text: `Посадка не улучшит участок: сейчас живо ${aliveNow}, прогноз — не больше ${hi}. Возможно, лучше ничего не трогать.` };
  if (lo === 0) return { level: "warn", text: "В части квантовых исходов посадка вымирает: это ставка, а не гарантия." };
  return { level: "ok", text: "Паттерн переживёт 16 поколений: живые клетки на вашей земле приносят долю эмиссии за эффективность." };
}
