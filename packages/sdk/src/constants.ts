// Mirrors programs/recursia/src/constants.rs — keep in sync (checked by tests).
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

/** Built-in "laws of physics" shipped as the first modules. */
export const PHYSICS_PRESETS = [
  { name: "Conway Life", birth: 1 << 3, survive: (1 << 2) | (1 << 3), royaltyBps: 100 },
  { name: "HighLife", birth: (1 << 3) | (1 << 6), survive: (1 << 2) | (1 << 3), royaltyBps: 150 },
  { name: "Day & Night", birth: (1 << 3) | (1 << 6) | (1 << 7) | (1 << 8), survive: (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 8), royaltyBps: 200 },
  { name: "Maze", birth: 1 << 3, survive: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5), royaltyBps: 100 },
  { name: "Seeds", birth: 1 << 2, survive: 0, royaltyBps: 300 },
  { name: "Coral", birth: 1 << 3, survive: (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8), royaltyBps: 250 },
] as const;

export function ruleString(birth: number, survive: number): string {
  const d = (m: number) => [...Array(9).keys()].filter((n) => (m >> n) & 1).join("");
  return `B${d(birth)}/S${d(survive)}`;
}
