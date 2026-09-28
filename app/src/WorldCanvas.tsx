import { useEffect, useRef, useState } from "react";
import { getCell, type MWorld } from "@recursia/sdk";
import { YOU } from "./sandbox";
import { Art, ART } from "./ui/Icon";

export function holderHue(holder: string): number {
  let h = 2166136261;
  for (let i = 0; i < holder.length; i++) h = Math.imul(h ^ holder.charCodeAt(i), 16777619);
  return Math.abs(h) % 360;
}

export function holderColor(holder: string | null, alpha = 1, you: string = YOU): string {
  if (!holder) return `rgba(150, 175, 255, ${alpha})`;
  if (holder === you || holder === YOU || holder.startsWith("ваш-")) return `rgba(255, 214, 107, ${alpha})`;
  return `hsla(${holderHue(holder)}, 85%, 66%, ${alpha})`;
}

interface Props {
  world: MWorld;
  selected: number | null;
  onSelect: (idx: number) => void;
  onDescend: (childId: string) => void;
  frame: number;
  zoomFrom: number | null;
  /** Territories currently in superposition (drawn as shimmering ψ frames). */
  superposed?: number[];
  /** Holder id rendered as "you" (gold). Sandbox: "Вы"; live mode: wallet pubkey. */
  youKey?: string;
}

const holderLabel = (h: string | null, you: string) => (!h ? "свободна" : h === you ? "ваша" : h.length > 20 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);

const SIZE = 640;
const CELL = SIZE / 64;

/** Static backdrop (vignette + nebula + dot lattice), rendered once per DPR and reused every frame. */
let backdrop: { dpr: number; canvas: HTMLCanvasElement } | null = null;
function getBackdrop(dpr: number): HTMLCanvasElement {
  if (backdrop?.dpr === dpr) return backdrop.canvas;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE * dpr;
  const g = cv.getContext("2d");
  if (!g) { backdrop = { dpr, canvas: cv }; return cv; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#04030b"; g.fillRect(0, 0, SIZE, SIZE);
  // Gradients are decoration only: some canvas implementations (privacy hardening,
  // test DOMs) return stubs — never let the backdrop take the map down.
  const radial = (x: number, y: number, r0: number, r1: number, c0: string, c1: string) => {
    try {
      const rg = g.createRadialGradient(x, y, r0, x, y, r1);
      if (!rg) return;
      rg.addColorStop(0, c0); rg.addColorStop(1, c1);
      g.fillStyle = rg; g.fillRect(0, 0, SIZE, SIZE);
    } catch { /* flat backdrop */ }
  };
  const neb = (x: number, y: number, r: number, c: string) => radial(x, y, 0, r, c, "rgba(0,0,0,0)");
  neb(SIZE * 0.78, SIZE * 0.18, SIZE * 0.55, "rgba(90, 70, 190, 0.16)");
  neb(SIZE * 0.2, SIZE * 0.85, SIZE * 0.5, "rgba(40, 150, 140, 0.11)");
  neb(SIZE * 0.5, SIZE * 0.5, SIZE * 0.7, "rgba(20, 16, 48, 0.35)");
  // dot lattice at every cell corner, brighter at territory corners
  for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) {
    const major = x % 8 === 0 && y % 8 === 0;
    g.fillStyle = major ? "rgba(170, 160, 255, 0.35)" : "rgba(140, 150, 255, 0.07)";
    const r = major ? 1.3 : 0.6;
    g.fillRect(x * CELL - r / 2, y * CELL - r / 2, r, r);
  }
  // vignette
  radial(SIZE / 2, SIZE / 2, SIZE * 0.35, SIZE * 0.75, "rgba(0,0,0,0)", "rgba(0,0,0,0.45)");
  backdrop = { dpr, canvas: cv };
  return cv;
}

/** Painted portal art, loaded once. */
let portalImg: HTMLImageElement | null = null;
function getPortalImg(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!portalImg) { portalImg = new Image(); portalImg.decoding = "async"; portalImg.src = ART.nested; }
  return portalImg.complete && portalImg.naturalWidth > 0 ? portalImg : null;
}

const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function WorldCanvas({ world, selected, onSelect, onDescend, frame: rawFrame, zoomFrom, superposed = [], youKey = YOU }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const frame = reducedMotion ? 0 : rawFrame;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== SIZE * dpr) { c.width = SIZE * dpr; c.height = SIZE * dpr; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(getBackdrop(dpr), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // territory tints
    world.territories.forEach((t, i) => {
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
      if (t.holder) {
        ctx.fillStyle = holderColor(t.holder, t.holder === youKey ? 0.13 : 0.08, youKey);
        ctx.fillRect(tx, ty, 8 * CELL, 8 * CELL);
      }
    });

    // cells
    const owners = world.territories.map((t) => t.holder);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (!getCell(world.grid, x, y)) continue;
        const idx = (y >> 3) * 8 + (x >> 3);
        // neon chip: tinted body + bright core
        ctx.fillStyle = holderColor(owners[idx], 0.9, youKey);
        ctx.fillRect(x * CELL + 1.2, y * CELL + 1.2, CELL - 2.4, CELL - 2.4);
      }
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (getCell(world.grid, x, y)) ctx.fillRect(x * CELL + CELL * 0.36, y * CELL + CELL * 0.36, CELL * 0.28, CELL * 0.28);
    }
    // glow pass
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = "blur(5px)";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(c, 0, 0, SIZE * dpr, SIZE * dpr, 0, 0, SIZE, SIZE);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // territory grid
    ctx.strokeStyle = "rgba(150, 140, 255, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * 8 * CELL + 0.5, 0); ctx.lineTo(i * 8 * CELL + 0.5, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 8 * CELL + 0.5); ctx.lineTo(SIZE, i * 8 * CELL + 0.5); ctx.stroke();
    }

    // child universes: nested-square portals
    const pulse = 0.5 + 0.5 * Math.sin(frame / 3);
    const portal = getPortalImg();
    world.territories.forEach((t, i) => {
      if (!t.childWorld) return;
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
      if (portal) {
        ctx.save();
        ctx.globalAlpha = 0.28 + 0.2 * pulse;
        ctx.globalCompositeOperation = "lighter";
        const m = 12; ctx.drawImage(portal, tx + m, ty + m, 8 * CELL - 2 * m, 8 * CELL - 2 * m);
        ctx.restore();
      }
      ctx.strokeStyle = `rgba(185, 140, 255, ${0.55 + 0.45 * pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 3, ty + 3, 8 * CELL - 6, 8 * CELL - 6);
      ctx.strokeStyle = `rgba(124, 247, 212, ${0.4 + 0.4 * pulse})`;
      ctx.strokeRect(tx + 16, ty + 16, 8 * CELL - 32, 8 * CELL - 32);
    });

    // superpositions: flickering dashed frame + "ψ" + ghost cells (uncollapsed)
    for (const i of superposed) {
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
      const ph = 0.5 + 0.5 * Math.sin(frame / 2 + i);
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.lineDashOffset = -frame;
      ctx.strokeStyle = `rgba(110, 220, 255, ${0.5 + 0.5 * ph})`; ctx.lineWidth = 2;
      ctx.strokeRect(tx + 2, ty + 2, 8 * CELL - 4, 8 * CELL - 4);
      ctx.setLineDash([]);
      let s = (frame * 2654435761 + i * 40503) >>> 0;
      ctx.fillStyle = `rgba(110, 220, 255, ${0.25 + 0.25 * ph})`;
      for (let k = 0; k < 6; k++) {
        s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
        ctx.fillRect(tx + (s & 7) * CELL + 2, ty + ((s >> 3) & 7) * CELL + 2, CELL - 4, CELL - 4);
      }
      ctx.font = "bold 16px ui-sans-serif, system-ui"; ctx.fillStyle = `rgba(190, 240, 255, ${0.6 + 0.4 * ph})`;
      ctx.fillText("ψ", tx + 8 * CELL - 16, ty + 18);
      ctx.restore();
    }

    const box = (i: number, color: string, w: number) => {
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
      ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.strokeRect(tx + w / 2, ty + w / 2, 8 * CELL - w, 8 * CELL - w);
    };
    if (hover !== null && hover !== selected) box(hover, "rgba(255,255,255,0.35)", 1.5);
    if (selected !== null) box(selected, "rgba(255, 214, 107, 0.95)", 2.5);
  }, [world, world.generation, selected, hover, frame, superposed.join(","), youKey]);

  const idxAt = (e: React.MouseEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return Math.max(0, Math.min(63, y * 8 + x));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const cur = selected ?? hover ?? 27;
    const x = cur % 8, y = Math.floor(cur / 8);
    const move: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      const nx = Math.max(0, Math.min(7, x + dx)), ny = Math.max(0, Math.min(7, y + dy));
      onSelect(ny * 8 + nx);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const t = world.territories[cur];
      if (selected === cur && t.childWorld) onDescend(t.childWorld); else onSelect(cur);
    }
  };
  const sel = selected !== null ? world.territories[selected] : null;
  const label = `Карта мира «${world.name}», 8 на 8 клеток. Стрелки — выбор клетки, Enter — войти во вложенную вселенную.`
    + (selected !== null && sel ? ` Выбрана клетка ${selected}: ${world.alive[selected]} живых, ${sel.holder ? (sel.holder === youKey ? "ваша" : "занята") : "свободна"}${sel.childWorld ? ", содержит вселенную" : ""}.` : "");

  const origin = zoomFrom !== null ? `${((zoomFrom % 8) + 0.5) * 12.5}% ${(Math.floor(zoomFrom / 8) + 0.5) * 12.5}%` : "50% 50%";
  return (
    <div className="canvas-wrap">
      <canvas
        key={world.id}
        ref={ref}
        className={zoomFrom !== null ? "world-canvas zoom-in" : "world-canvas"}
        style={{ transformOrigin: origin }}
        tabIndex={0}
        role="img"
        aria-label={label}
        onKeyDown={onKey}
        onMouseMove={(e) => setHover(idxAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSelect(idxAt(e))}
        onDoubleClick={(e) => { const t = world.territories[idxAt(e)]; if (t.childWorld) onDescend(t.childWorld); }}
      />
      {hover !== null && (
        <div className="hover-tip" aria-hidden="true">
          #{hover} · {world.alive[hover]} клеток · {holderLabel(world.territories[hover].holder, youKey)}
          {world.territories[hover].childWorld ? <> · <Art name="nested" size={14} /> вселенная (двойной клик)</> : ""}
        </div>
      )}
    </div>
  );
}
