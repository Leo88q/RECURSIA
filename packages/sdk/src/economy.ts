// Mirror of programs/recursia/src/math.rs (all bigint, floor division).
import { BPS, SEASON_PRIZE_CAP_BPS, SEASON_TOP, TERRITORIES } from "./constants.js";

export const bpsFloor = (amount: bigint, bps: number | bigint) => (amount * BigInt(bps)) / BPS;
const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

export interface TickSplit { cranker: bigint; protocol: bigint; host: bigint; royalty: bigint; pool: bigint }

export function splitTick(cost: bigint, crankerBps: number, protocolBps: number, hostBps: number, royaltyBps: number, hasHost: boolean): TickSplit {
  const cranker = bpsFloor(cost, crankerBps);
  const protocol = bpsFloor(cost, protocolBps);
  const host = hasHost ? bpsFloor(cost, hostBps) : 0n;
  const royalty = bpsFloor(cost, royaltyBps);
  const pool = cost - cranker - protocol - host - royalty;
  if (pool < 0n) throw new Error("split overflow");
  return { cranker, protocol, host, royalty, pool };
}

/** Player spend split: `studioBps` → studio treasury, remainder → player reward pool. */
export function splitSpend(amount: bigint, studioBps: number): { studio: bigint; pool: bigint } {
  const studio = bpsFloor(amount, studioBps);
  return { studio, pool: amount - studio };
}

export function harbergerDue(price: bigint, rateBps: number, elapsed: bigint, epochSlots: bigint): bigint {
  if (price === 0n || elapsed === 0n) return 0n;
  return divCeil(price * BigInt(rateBps) * elapsed, BPS * epochSlots);
}

export const epochTax = (price: bigint, rateBps: number) => divCeil(price * BigInt(rateBps), BPS);

export function worldEmission(emission: bigint, totalSink: bigint, sinkW: bigint, rebateCapBps: number, alreadyClaimed: bigint): bigint {
  if (totalSink === 0n || sinkW === 0n || emission === 0n) return 0n;
  const proRata = (emission * sinkW) / totalSink;
  const cap = bpsFloor(sinkW, rebateCapBps);
  const remaining = emission > alreadyClaimed ? emission - alreadyClaimed : 0n;
  return [proRata, cap, remaining].reduce((a, b) => (a < b ? a : b));
}

/** Mirror of math::world_sponsor: pro rata by owned live-cell score, capped by the world's own pool contribution. */
export function worldSponsor(budget: bigint, totalScore: bigint, scoreW: bigint, sinkW: bigint, capBps: number, alreadyClaimed: bigint): bigint {
  if (budget === 0n || totalScore === 0n || scoreW === 0n || sinkW === 0n) return 0n;
  const proRata = (budget * scoreW) / totalScore;
  const cap = bpsFloor(sinkW, capBps);
  const remaining = budget > alreadyClaimed ? budget - alreadyClaimed : 0n;
  return [proRata, cap, remaining].reduce((a, b) => (a < b ? a : b));
}

/** Mirror of math::season_prize: rank share of the pool, ≤ SEASON_PRIZE_CAP_BPS of the winner's points. */
export function seasonPrize(pool: bigint, rankBps: number, points: bigint): bigint {
  const share = bpsFloor(pool, rankBps);
  const cap = bpsFloor(points, SEASON_PRIZE_CAP_BPS);
  return share < cap ? share : cap;
}

export interface LeaderEntry<K> { player: K; points: bigint }
/** Mirror of season::leaderboard_insert (stable sort, points desc, one entry per player). */
export function leaderboardInsert<K>(top: LeaderEntry<K>[], entry: LeaderEntry<K>, isEmpty: (k: K) => boolean, eq: (a: K, b: K) => boolean): boolean {
  const pos = top.findIndex((e) => eq(e.player, entry.player));
  if (pos >= 0) {
    if (entry.points > top[pos].points) top[pos].points = entry.points;
  } else {
    const last = SEASON_TOP - 1;
    if (!isEmpty(top[last].player) && top[last].points >= entry.points) return false;
    top[last] = { ...entry };
  }
  top.sort((a, b) => (b.points > a.points ? 1 : b.points < a.points ? -1 : 0)); // Array.sort is stable
  return true;
}

export function distribute(amount: bigint, scores: number[], owned: boolean[]): { shares: bigint[]; rest: bigint } {
  const shares = new Array<bigint>(TERRITORIES).fill(0n);
  const total = scores.reduce((a, s) => a + BigInt(s), 0n);
  if (total === 0n || amount === 0n) return { shares, rest: amount };
  let paid = 0n;
  for (let i = 0; i < TERRITORIES; i++) {
    if (!owned[i] || scores[i] === 0) continue;
    shares[i] = (amount * BigInt(scores[i])) / total;
    paid += shares[i];
  }
  return { shares, rest: amount - paid };
}

export const fmt = (v: bigint, decimals = 6, digits = 2) => {
  const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = ((v % base) * 10n ** BigInt(digits)) / base;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${digits ? "." + frac.toString().padStart(digits, "0") : ""}`;
};
