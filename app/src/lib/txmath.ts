// Pure helpers for the transaction pipeline (unit-tested, no web3 import).

export const MAX_CU = 1_400_000;
export const BASE_FEE_LAMPORTS = 5_000;

export type PriorityLevel = "none" | "normal" | "fast";
export const PRIORITY_LABEL: Record<PriorityLevel, string> = { none: "без приоритета", normal: "обычный", fast: "быстрый" };

/** Simulated units + 15% headroom + fixed margin, capped at the protocol max. */
export function computeUnitLimit(simulatedUnits: number | undefined): number {
  if (!simulatedUnits || !Number.isFinite(simulatedUnits) || simulatedUnits <= 0) return 400_000;
  return Math.min(MAX_CU, Math.ceil(simulatedUnits * 1.15) + 5_000);
}

/**
 * Picks a micro-lamport-per-CU price from getRecentPrioritizationFees samples:
 * median ("normal") or 90th percentile ("fast") of the non-zero samples,
 * floored at a small minimum and ALWAYS clamped to `cap` so a spiky RPC or a
 * malicious endpoint can't make the user overpay.
 */
export function pickPriorityFee(samples: readonly number[], level: PriorityLevel, cap: number): number {
  if (level === "none") return 0;
  const xs = samples.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const floor = level === "fast" ? 10_000 : 1_000;
  if (xs.length === 0) return Math.min(floor, cap);
  const q = level === "fast" ? 0.9 : 0.5;
  const v = xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  return Math.max(0, Math.min(cap, Math.max(floor, Math.round(v))));
}

/** Total network fee in lamports: base per signature + priority (µ-lamports × CU / 1e6). */
export function estimateFeeLamports(cuLimit: number, microLamports: number, signatures = 1): number {
  return BASE_FEE_LAMPORTS * signatures + Math.ceil((cuLimit * microLamports) / 1_000_000);
}

/** SPL token account `amount` (u64 LE at offset 64). null for non-token data. */
export function readTokenAmount(data: Uint8Array | null | undefined): bigint | null {
  if (!data || data.length < 72) return null;
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[64 + i]);
  return v;
}

export type TxPhase = "simulating" | "preview" | "signing" | "sending" | "confirming" | "confirmed" | "failed";
export const PHASE_LABEL: Record<TxPhase, string> = {
  simulating: "Симуляция…", preview: "Проверьте и подпишите", signing: "Ожидание подписи в кошельке…",
  sending: "Отправка в сеть…", confirming: "Подтверждение…", confirmed: "Подтверждено", failed: "Не выполнено",
};
