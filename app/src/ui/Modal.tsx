import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Only the top-most dialog handles Esc / Tab (e.g. tx preview over a form). */
const stack: symbol[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: role=dialog + aria-modal, labelled by its title, focus is
 * trapped inside and restored on close, Esc closes (unless `locked`, e.g.
 * while a transaction is being signed), body scroll is locked.
 */
export function Modal({ title, onClose, children, locked = false, wide = false, className = "" }: {
  title: ReactNode; onClose: () => void; children: ReactNode; locked?: boolean; wide?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const lockedRef = useRef(locked); lockedRef.current = locked;

  useEffect(() => {
    const me = Symbol("modal");
    stack.push(me);
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape" && !lockedRef.current) { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (els.length === 0) { e.preventDefault(); return; }
      const a = els[0], z = els[els.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(me), 1);
      if (stack.length === 0) document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !lockedRef.current) onClose(); }}>
      <div ref={ref} className={`modal ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {!locked && <button className="icon-btn" onClick={onClose} aria-label="Закрыть">×</button>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
