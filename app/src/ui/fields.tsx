import { useId, useState, type ReactNode } from "react";
import { formatAmount, parseAmount, shortAddr, toInput } from "../lib/format";
import { explorerUrl } from "../lib/config";

/** Controlled RCR amount field: strict parsing, inline error, optional "макс". */
export function AmountField({ label, value, onChange, max, min, allowZero, hint, suffix = "RCR" }: {
  label: ReactNode; value: string; onChange: (v: string) => void; max?: bigint; min?: bigint; allowZero?: boolean; hint?: ReactNode; suffix?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const p = parseAmount(value, { max, min, allowZero });
  const err = touched && !p.ok ? p.error : null;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`amount ${err ? "invalid" : ""}`}>
        <input id={id} inputMode="decimal" autoComplete="off" spellCheck={false} value={value}
          aria-invalid={!!err} aria-describedby={err || hint ? `${id}-d` : undefined}
          onChange={(e) => { setTouched(true); onChange(e.target.value); }} onBlur={() => setTouched(true)} />
        <span className="suffix">{suffix}</span>
        {max !== undefined && max > 0n && <button type="button" className="chip" onClick={() => { setTouched(true); onChange(toInput(max)); }}>макс</button>}
      </div>
      {(err || hint) && <div id={`${id}-d`} className={err ? "field-err" : "field-hint"}>{err ?? hint}</div>}
    </div>
  );
}

/** Parses an AmountField value; returns null when invalid (caller disables submit). */
export const amountOf = (v: string, opts?: { max?: bigint; min?: bigint; allowZero?: boolean }) => { const p = parseAmount(v, opts); return p.ok ? p.value : null; };

export function Address({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="addr">
      <a href={explorerUrl("address", value)} target="_blank" rel="noopener noreferrer" className="mono" title={value}>{label ?? shortAddr(value)}</a>
      <button type="button" className="icon-btn tiny" aria-label="Скопировать адрес" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "✓" : "⧉"}</button>
    </span>
  );
}

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <div key={i} style={{ width: `${90 - i * 15}%` }} />)}</div>;
}

export const Rcr = ({ v, digits = 2 }: { v: bigint; digits?: number }) => <span className="num">{formatAmount(v, digits)}&nbsp;RCR</span>;
