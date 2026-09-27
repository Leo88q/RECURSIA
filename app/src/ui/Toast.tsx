import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Glyph } from "./Icon";

export type ToastKind = "ok" | "bad" | "info";
export interface ToastInput { kind?: ToastKind; title: string; body?: string; href?: string; hrefLabel?: string; ttl?: number }
interface ToastItem extends ToastInput { id: number }

interface Ctx { push: (t: ToastInput) => number; dismiss: (id: number) => void }
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    const t = timers.current.get(id); if (t) window.clearTimeout(t); timers.current.delete(id);
  }, []);
  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    const ttl = t.ttl ?? (t.kind === "bad" ? 7000 : 4000);
    if (ttl > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), ttl));
    return id;
  }, [dismiss]);
  useEffect(() => () => { for (const t of timers.current.values()) window.clearTimeout(t); }, []);
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Уведомления">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? "info"}`} role={t.kind === "bad" ? "alert" : "status"} aria-live={t.kind === "bad" ? "assertive" : "polite"}>
            <div className="toast-main">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
              {t.href && <a className="toast-link" href={t.href} target="_blank" rel="noopener noreferrer">{t.hrefLabel ?? "Открыть в эксплорере"} <Glyph name="external" size={12} /></a>}
            </div>
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}

/** Adapter for the legacy `notify(err, ok)` callback style used by sandbox panels. */
export function useNotify() {
  const { push } = useToast();
  return useCallback((err: string | null, ok?: string) => {
    if (err) push({ kind: "bad", title: err });
    else if (ok) push({ kind: "ok", title: ok });
  }, [push]);
}
