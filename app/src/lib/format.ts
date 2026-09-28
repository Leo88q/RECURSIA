// Pure formatting / parsing helpers. No floats anywhere on the money path:
// user input is parsed straight into integer base units (6 decimals).

export const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

export type Parsed = { ok: true; value: bigint } | { ok: false; error: string };

/**
 * Strictly parses a human SKR amount ("12", "12.5", "0,000001") into base
 * units. Rejects exponent notation, signs, more than 6 decimals, and values
 * above `max` — never silently rounds.
 */
export function parseAmount(input: string, opts: { max?: bigint; min?: bigint; allowZero?: boolean } = {}): Parsed {
  const s = input.trim().replace(/\s+/g, "").replace(",", ".");
  if (s === "") return { ok: false, error: "введите сумму" };
  const m = /^(\d{1,15})(?:\.(\d{0,6}))?$/.exec(s);
  if (!m) return /^\d+\.\d{7,}$/.test(s) ? { ok: false, error: "не больше 6 знаков после запятой" } : { ok: false, error: "некорректное число" };
  const value = BigInt(m[1]) * UNIT + BigInt((m[2] ?? "").padEnd(DECIMALS, "0"));
  if (value === 0n && !opts.allowZero) return { ok: false, error: "сумма должна быть больше нуля" };
  if (opts.min !== undefined && value < opts.min) return { ok: false, error: `минимум ${formatAmount(opts.min)}` };
  if (opts.max !== undefined && value > opts.max) return { ok: false, error: `максимум ${formatAmount(opts.max)}` };
  return { ok: true, value };
}

/** Base units → "1 234,56" (ru-RU grouping, trailing zeros trimmed). */
export function formatAmount(v: bigint, maxDigits = 6): string {
  const neg = v < 0n; const a = neg ? -v : v;
  const whole = a / UNIT;
  let frac = (a % UNIT).toString().padStart(DECIMALS, "0").slice(0, maxDigits).replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  if (frac === "" && a !== 0n && whole === 0n) frac = ""; // below display precision
  return `${neg ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}
export const rcr = (v: bigint, digits = 2) => `${formatAmount(v, digits)} SKR`;

/** Base units → value for an <input> ("12.5"), inverse of parseAmount. */
export function toInput(v: bigint): string {
  const whole = v / UNIT, frac = (v % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function compact(v: bigint): string {
  const n = Number(v / UNIT);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export const shortAddr = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export const lamportsToSol = (l: number | bigint) => (Number(l) / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 6 });

/** ~400 ms per slot. Human "≈ 2 ч 15 мин". */
export function slotsToHuman(slots: number | bigint): string {
  const sec = Math.max(0, Math.round(Number(slots) * 0.4));
  if (sec < 60) return `≈ ${sec} с`;
  const min = Math.round(sec / 60);
  if (min < 60) return `≈ ${min} мин`;
  const h = Math.floor(min / 60), mm = min % 60;
  if (h < 48) return `≈ ${h} ч${mm ? ` ${mm} мин` : ""}`;
  return `≈ ${Math.round(h / 24)} дн`;
}

/**
 * The simulation core writes events in the 3rd person ("X предлагает…").
 * When X is the local player ("Вы") the verb must agree with 2nd-person
 * plural: "Вы предлагаете", "Вы создали", and "предлагает Вы" → "предлагает вам".
 */
export function youify(text: string, you = "Вы"): string {
  let t = text;
  const esc = you.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  t = t.replace(new RegExp(`^${esc} ([а-яё]+?)(ал|ил|ял|ел|ыл)(\\b|(?=[^а-яё]))`, "i"), (_m, stem: string, suf: string) => `${you} ${stem}${suf}и`);
  t = t.replace(new RegExp(`^${esc} ([а-яё]+?)(ает|яет|еет|ует|ёт)(?=[^а-яё]|$)`, "i"), (_m, stem: string, suf: string) => `${you} ${stem}${suf.slice(0, -1)}те`);
  t = t.replace(new RegExp(`^${esc} ([а-яё]+?)ит(?=[^а-яё]|$)`, "i"), (_m, stem: string) => `${you} ${stem}ите`);
  t = t.replace(new RegExp(`(предлагает|передаёт|продаёт|уступает) ${esc}(?=[^а-яё]|$)`, "g"), "$1 вам");
  t = t.replace(new RegExp(`(^|[^а-яё])(к|у|от) ${esc}(?=[^а-яё]|$)`, "g"), (_m, pre: string, prep: string) => `${pre}${prep} ${prep === "к" ? "вам" : "вас"}`);
  return t;
}
