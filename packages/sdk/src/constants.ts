// Mirrors programs/recursia/src/constants.rs — keep in sync (checked by tests).
/** Program id as a plain string (no web3 import — keeps light bundles light). */
export const PROGRAM_ID_STR = "2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik";
export const GRID = 64;
export const TERRITORIES = 64;
export const MAX_DEPTH = 7;
export const DECIMALS = 6;
export const ONE = 1_000_000n;
export const TOTAL_SUPPLY = 1_000_000_000n * ONE;
export const REWARD_POOL_BPS = 4_500n;
export const TREASURY_BPS = 1_000n;
export const BPS = 10_000n;
export const MIN_TIMELOCK_SECS = 48 * 60 * 60;
export const MIN_TICK_BURN_BPS = 3_000;
export const MAX_ROYALTY_BPS = 500;
export const MAX_ARCHITECT_FEE_BPS = 3_000;
export const MAX_PRICE = 1_000_000_000n * ONE;
export const PLANT_COOLDOWN_TICKS = 1;
export const PRICE_CHANGE_COOLDOWN_SLOTS = 150;
export const REBELLION_THRESHOLD_BPS = 6_667;
export const REBELLION_MIN_VOTES = 8;
export const REBELLION_COOLDOWN_SLOTS = 216_000;
export const BREACH_POPULATION = 400;
export const BREACH_RESONANCE = 64;
export const PERMIT_PLANT = 1;
export const PERMIT_ACQUIRE = 2;

export interface Params {
  timelockSecs: bigint;
  worldCreateFee: bigint;
  moduleRegisterFee: bigint;
  feeBurnBps: number;
  tickCost: bigint;
  tickIntervalSlots: bigint;
  gensPerTick: number;
  crankerBps: number;
  protocolBps: number;
  hostBps: number;
  epochSlots: bigint;
  emissionRateBps: number;
  rebateCapBps: number;
  harbergerBps: number;
  minPrice: bigint;
  plantCost: bigint;
}

export const DEFAULT_PARAMS: Params = {
  timelockSecs: BigInt(MIN_TIMELOCK_SECS),
  worldCreateFee: 1_000n * ONE,
  moduleRegisterFee: 5_000n * ONE,
  feeBurnBps: 5_000,
  tickCost: 10n * ONE,
  tickIntervalSlots: 150n,
  gensPerTick: 4,
  crankerBps: 200,
  protocolBps: 1_000,
  hostBps: 1_500,
  epochSlots: 216_000n,
  emissionRateBps: 50,
  rebateCapBps: 9_000,
  harbergerBps: 50,
  minPrice: 10n * ONE,
  plantCost: 5n * ONE,
};

export interface PhysicsPreset { name: string; birth: number; survive: number; royaltyBps: number; qBirth: number; qSurvive: number; qAmp: number; blurb?: string }
const Bm = (...n: number[]) => n.reduce((a, x) => a | (1 << x), 0);

/** Built-in "laws of physics" shipped as the first modules. */
export const PHYSICS_PRESETS: readonly PhysicsPreset[] = [
  { name: "Conway Life", birth: Bm(3), survive: Bm(2, 3), royaltyBps: 100, qBirth: 0, qSurvive: 0, qAmp: 0 },
  { name: "HighLife", birth: Bm(3, 6), survive: Bm(2, 3), royaltyBps: 150, qBirth: 0, qSurvive: 0, qAmp: 0 },
  { name: "Day & Night", birth: Bm(3, 6, 7, 8), survive: Bm(3, 4, 6, 7, 8), royaltyBps: 200, qBirth: 0, qSurvive: 0, qAmp: 0 },
  { name: "Maze", birth: Bm(3), survive: Bm(1, 2, 3, 4, 5), royaltyBps: 100, qBirth: 0, qSurvive: 0, qAmp: 0 },
  { name: "Seeds", birth: Bm(2), survive: 0, royaltyBps: 300, qBirth: 0, qSurvive: 0, qAmp: 0 },
  { name: "Coral", birth: Bm(3), survive: Bm(4, 5, 6, 7, 8), royaltyBps: 250, qBirth: 0, qSurvive: 0, qAmp: 0 },
  // --- quantum laws: counts in qBirth/qSurvive fire with p = 2^-qAmp (unpredictable offline)
  { name: "Copenhagen", birth: Bm(3), survive: Bm(2, 3), royaltyBps: 200, qBirth: Bm(6), qSurvive: 0, qAmp: 1, blurb: "Жизнь Конвея + рождение при 6 соседях с вероятностью ½" },
  { name: "Quantum Foam", birth: Bm(3), survive: Bm(2, 3), royaltyBps: 250, qBirth: Bm(6), qSurvive: Bm(4), qAmp: 2, blurb: "кипящая пена: B6 и S4 срабатывают с вероятностью ¼" },
  { name: "Vacuum Fluctuations", birth: Bm(3), survive: Bm(2, 3), royaltyBps: 250, qBirth: Bm(2), qSurvive: 0, qAmp: 3, blurb: "из пустоты рождается жизнь: B2 с вероятностью ⅛" },
  { name: "Tunnel Life", birth: Bm(3, 6), survive: Bm(2, 3), royaltyBps: 300, qBirth: 0, qSurvive: Bm(4), qAmp: 2, blurb: "HighLife + туннельное выживание S4 с вероятностью ¼" },
];

export function ruleString(birth: number, survive: number, qBirth = 0, qSurvive = 0, qAmp = 0): string {
  const d = (m: number) => [...Array(9).keys()].filter((n) => (m >> n) & 1).join("");
  const base = `B${d(birth)}/S${d(survive)}`;
  if (!qAmp || !(qBirth | qSurvive)) return base;
  return `${base} ⚛${qBirth ? ` qB${d(qBirth)}` : ""}${qSurvive ? ` qS${d(qSurvive)}` : ""} p=1/${1 << qAmp}`;
}
