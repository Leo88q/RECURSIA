// Entry cost & price list for the landing page — computed from the protocol
// parameters (DEFAULT_PARAMS = values `initialize` writes on-chain) and the
// account layouts (programs/recursia/src/state.rs, `8 + INIT_SPACE`), so the
// page can never drift from the contract. Governance can change the params
// later within hard bounds (48 h timelock); the landing says so.
import { DEFAULT_PARAMS, QUANTUM_BOUNTY_DIV, QUANTUM_DELAY_SLOTS, QUANTUM_REVEAL_SLOTS, QUANTUM_STAKE_MULT, SWAP_BOUNTY_DIV, SWAP_OFFER_TTL_SLOTS, epochTax, type Params } from "@recursia/sdk";

/** Account sizes in bytes, discriminator included (8 + INIT_SPACE). */
export const ACCOUNT_BYTES = {
  player: 78,
  territory: 160,
  /** SPL token account: your SKR wallet (ATA), a world vault, an agent vault. */
  tokenAccount: 165,
  superposition: 214,
  swap: 152,
  permit: 156,
  module: 113,
  /** = SDK WORLD_SPACE (asserted in test; not imported: layout.ts pulls web3.js into the landing chunk). */
  world: 2022,
} as const;

/** Solana rent-exempt minimum: (128 header + data) × 3480 lamports/byte-year × 2 years. */
export const rentLamports = (bytes: number) => (128 + bytes) * 3_480 * 2;
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Base fee per signature (priority fee is extra and capped by the client). */
export const SIGNATURE_LAMPORTS = 5_000;
/** Average slot time used for human-readable durations. */
export const SLOT_SECONDS = 0.4;

export interface EntryCost {
  /** SKR base units */
  claim: bigint; deposit: bigint; depositWeek: bigint; plant: bigint; minTotal: bigint; weekTotal: bigint;
  /** lamports */
  rentPlayer: number; rentTerritory: number; rentAta: number; fees: number; solMax: number;
}

/**
 * Cheapest honest start: claim a free cell (pays `minPrice` into the world's
 * energy), declare the same price, leave the minimum tax deposit (one epoch),
 * plant one pattern. SOL side is the worst case: all three accounts are new.
 */
export function entryCost(p: Params = DEFAULT_PARAMS): EntryCost {
  const claim = p.minPrice;
  const deposit = epochTax(claim, p.harbergerBps);
  const depositWeek = deposit * 7n;
  const plant = p.plantCost;
  const rentPlayer = rentLamports(ACCOUNT_BYTES.player);
  const rentTerritory = rentLamports(ACCOUNT_BYTES.territory);
  const rentAta = rentLamports(ACCOUNT_BYTES.tokenAccount);
  const fees = 2 * SIGNATURE_LAMPORTS; // acquire + plant
  return {
    claim, deposit, depositWeek, plant,
    minTotal: claim + deposit + plant, weekTotal: claim + depositWeek + plant,
    rentPlayer, rentTerritory, rentAta, fees,
    solMax: rentPlayer + rentTerritory + rentAta + fees,
  };
}

export interface PriceRow { what: string; rcr: string; sol: string; back: string }

const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("ru-RU")}%`;

/** Every paid action in the game, formatted for the landing table. */
export function priceList(p: Params = DEFAULT_PARAMS, fmt: (v: bigint) => string, sol: (lamports: number) => string): PriceRow[] {
  const stake = p.plantCost * QUANTUM_STAKE_MULT;
  const worldRent = rentLamports(ACCOUNT_BYTES.world) + rentLamports(ACCOUNT_BYTES.tokenAccount);
  return [
    { what: "Занять свободную клетку", rcr: `${fmt(p.minPrice)} (в энергию мира) + депозит налога ≥ 1 эпохи`, sol: `до ${sol(rentLamports(ACCOUNT_BYTES.player) + rentLamports(ACCOUNT_BYTES.territory))} аренды`, back: "депозит — да (кроме налога за прошедшее время)" },
    { what: "Выкупить занятую клетку", rcr: "цена, объявленная владельцем + депозит налога ≥ 1 эпохи", sol: `до ${sol(rentLamports(ACCOUNT_BYTES.player))}`, back: "цена целиком уходит продавцу" },
    { what: "Налог Харбергера", rcr: `${pct(p.harbergerBps)} вашей цены за эпоху (≈ сутки)`, sol: "—", back: "нет: до 30% — архитектору мира, остальное — в энергию мира" },
    { what: "Посадить узор 8×8", rcr: `${fmt(p.plantCost)} (${pct(p.protocolBps)} — студии, остальное — в пул наград)`, sol: "только комиссия сети", back: "нет" },
    { what: "Суперпозиция (2 узора сразу)", rcr: `${fmt(p.plantCost)} плата + залог ${fmt(stake)}`, sol: sol(rentLamports(ACCOUNT_BYTES.superposition)), back: `залог минус ${fmt(stake / QUANTUM_BOUNTY_DIV)} наблюдателю; аренда SOL — да` },
    { what: "Запутанная пара клеток", rcr: `${fmt(p.plantCost * 2n)} плата + залог ${fmt(stake * 2n)}`, sol: sol(rentLamports(ACCOUNT_BYTES.superposition)), back: "так же, как у суперпозиции" },
    { what: "Предложить SWAP исходов", rcr: `сбор ${fmt(p.plantCost)} (${pct(10_000n / SWAP_BOUNTY_DIV)} — резолверу, остальное — плата) + премия (сколько решите)`, sol: sol(rentLamports(ACCOUNT_BYTES.swap)), back: "премия — при отмене; аренда SOL — да" },
    { what: "Открыть дочерний или нейтральный мир", rcr: `${fmt(p.worldCreateFee)} (${pct(p.protocolBps)} — студии, остальное — в пул наград) + стартовая энергия (тик стоит ${fmt(p.tickCost)})`, sol: sol(worldRent), back: "нет — мир остаётся в сети навсегда" },
    { what: "Опубликовать закон физики", rcr: `${fmt(p.moduleRegisterFee)} (${pct(p.protocolBps)} — студии, остальное — в пул наград)`, sol: sol(rentLamports(ACCOUNT_BYTES.module)), back: "нет, зато роялти до 5% с каждого тика" },
    { what: "Нанять ИИ-жителя (доверенность)", rcr: "бюджет, который вы сами положите в хранилище агента", sol: sol(rentLamports(ACCOUNT_BYTES.permit) + rentLamports(ACCOUNT_BYTES.tokenAccount)), back: "остаток бюджета и аренда — при отзыве" },
    { what: "Тикнуть мир / наблюдать / разрешить SWAP", rcr: "бесплатно, это заработок", sol: "только комиссия сети", back: `вы получаете ${pct(p.crankerBps)} тика, 5% залога или 20% сбора SWAP` },
  ];
}

/** Slots → "≈ 24 ч" style durations. */
export function slotsHuman(slots: number | bigint): string {
  const s = Number(slots) * SLOT_SECONDS;
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString("ru-RU");
  if (s < 60) return `≈${n(s)} с`;
  if (s < 5_400) return `≈${n(s / 60)} мин`;
  if (s < 172_800) return `≈${n(s / 3_600)} ч`;
  return `≈${n(s / 86_400)} сут`;
}

export const QUANTUM_TIMING = { delay: QUANTUM_DELAY_SLOTS, reveal: QUANTUM_REVEAL_SLOTS, swapTtl: SWAP_OFFER_TTL_SLOTS };

/** SKR price used for the rough fiat estimate on the landing (Solscan, 27 Sep 2026). */
export const SKR_USD_APPROX = 0.019;
export const SKR_USD_DATE = "сентябрь 2026";
/** Rough USD value of an SKR amount (base units), rounded to whole dollars. */
export const usdApprox = (v: bigint) => Math.round((Number(v) / 1e6) * SKR_USD_APPROX);
