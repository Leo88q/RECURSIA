// Mirror of programs/recursia/src/math.rs (all bigint, floor division).
import { BPS, TERRITORIES } from "./constants.js";

export const bpsFloor = (amount: bigint, bps: number | bigint) => (amount * BigInt(bps)) / BPS;
const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

export interface TickSplit { cranker: bigint; protocol: bigint; host: bigint; royalty: bigint; burn: bigint }

export function splitTick(cost: bigint, crankerBps: number, protocolBps: number, hostBps: number, royaltyBps: number, hasHost: boolean): TickSplit {
  const cranker = bpsFloor(cost, crankerBps);
  const protocol = bpsFloor(cost, protocolBps);
  const host = hasHost ? bpsFloor(cost, hostBps) : 0n;
  const royalty = bpsFloor(cost, royaltyBps);
  const burn = cost - cranker - protocol - host - royalty;
  if (burn < 0n) throw new Error("split overflow");
  return { cranker, protocol, host, royalty, burn };
}

export function harbergerDue(price: bigint, rateBps: number, elapsed: bigint, epochSlots: bigint): bigint {
  if (price === 0n || elapsed === 0n) return 0n;
  return divCeil(price * BigInt(rateBps) * elapsed, BPS * epochSlots);
}

export const epochTax = (price: bigint, rateBps: number) => divCeil(price * BigInt(rateBps), BPS);

export function worldEmission(emission: bigint, totalBurn: bigint, burnW: bigint, rebateCapBps: number, alreadyClaimed: bigint): bigint {
  if (totalBurn === 0n || burnW === 0n || emission === 0n) return 0n;
  const proRata = (emission * burnW) / totalBurn;
  const cap = bpsFloor(burnW, rebateCapBps);
  const remaining = emission > alreadyClaimed ? emission - alreadyClaimed : 0n;
  return [proRata, cap, remaining].reduce((a, b) => (a < b ? a : b));
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
