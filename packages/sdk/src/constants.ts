// Mirrors programs/recursia/src/constants.rs — keep in sync (checked by tests).
/** Program id as a plain string (no web3 import — keeps light bundles light). */
export const PROGRAM_ID_STR = "2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik";
/** Official SKR mint (Solana Mobile). Counterfeit "SKR" mints exist — never trust the ticker. */
export const SKR_MINT_STR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const TOKEN_SYMBOL = "SKR";
export const GRID = 64;
export const TERRITORIES = 64;
export const MAX_DEPTH = 7;
export const DECIMALS = 6;
export const ONE = 1_000_000n;
/** Approximate SKR supply (Sep 2026) — used only by the offline model / econ-sim. */
export const SKR_SUPPLY_APPROX = 10_620_000_000n * ONE;
export const BPS = 10_000n;
export const MIN_TIMELOCK_SECS = 48 * 60 * 60;
export const MIN_TICK_POOL_BPS = 3_000;
export const MAX_PROTOCOL_BPS = 2_500;

// Sponsor pool (mirror of constants.rs): extra rewards by live cells.
/** Share of the sponsor pool paid out per epoch. */
export const SPONSOR_RATE_BPS = 1_000;
/** A world's sponsor reward ≤ this share of its own reward-pool contribution. */
export const SPONSOR_CAP_BPS = 10_000;

// Seasons (mirror of constants.rs).
export const SEASON_EPOCHS = 7;
/** Share of studio inflow swept into the season prize pool (25% of 20% = 5% of all spend). */
export const SEASON_SHARE_BPS = 2_500;
/** A prize never exceeds this share of the winner's own season points. */
export const SEASON_PRIZE_CAP_BPS = 2_500;
export const SEASON_TOP = 10;
export const SEASON_RANK_BPS = [3_000, 2_000, 1_500, 1_000, 800, 600, 400, 300, 200, 200] as const;
/** Share of each epoch's emission split by live cells on owned land across ALL worlds (skill redistribution). */
export const EFFICIENCY_SHARE_BPS = 3_000;
/** Per-world cap of the efficiency share: ≤ 200% of the world's own pool contribution. */
export const EFFICIENCY_CAP_BPS = 20_000;
/** Tournaments: 10% rake to the studio, top 30% of entrants paid (linear weights). */
export const TOURNAMENT_RAKE_BPS = 1_000;
export const TOURNAMENT_PAID_BPS = 3_000;
/** Entry-fee tiers in units of plant_cost (700 and 7 000 SKR by default). */
export const TOURNAMENT_TIERS = [2n, 20n] as const;
export const TOURNAMENT_MAX_PLAYERS = 40;
export const TOURNAMENT_TOP = 12;
export const TOURNAMENT_JOIN_EPOCHS = 1;
export const MAX_EMISSION_RATE_BPS = 2_000;
export const MAX_ROYALTY_BPS = 500;
export const MAX_ARCHITECT_FEE_BPS = 3_000;
export const MAX_PRICE = 1_000_000_000n * ONE;
export const PLANT_COOLDOWN_TICKS = 1;
export const PRICE_CHANGE_COOLDOWN_SLOTS = 150;
export const REBELLION_THRESHOLD_BPS = 6_667;
export const REBELLION_MIN_VOTES = 8;
export const REBELLION_COOLDOWN_SLOTS = 216_000;
/** Hold-up: execution only after epochSlots / DIV slots (checklist #94), mirrors `P/constants.rs`. */
export const REBELLION_HOLD_DIV = 8;
export const BREACH_POPULATION = 400;
export const BREACH_RESONANCE = 64;
export const PERMIT_PLANT = 1;
export const PERMIT_ACQUIRE = 2;

export interface Params {
  timelockSecs: bigint;
  worldCreateFee: bigint;
  moduleRegisterFee: bigint;
  tickCost: bigint;
  tickIntervalSlots: bigint;
  gensPerTick: number;
  crankerBps: number;
  /** Studio share of every player spend (rest → player reward pool). */
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
  worldCreateFee: 70_000n * ONE,
  moduleRegisterFee: 350_000n * ONE,
  tickCost: 700n * ONE,
  tickIntervalSlots: 150n,
  gensPerTick: 4,
  crankerBps: 200,
  protocolBps: 2_000,
  hostBps: 1_500,
  epochSlots: 216_000n,
  emissionRateBps: 1_000,
  rebateCapBps: 10_000,
  harbergerBps: 50,
  minPrice: 700n * ONE,
  plantCost: 350n * ONE,
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
