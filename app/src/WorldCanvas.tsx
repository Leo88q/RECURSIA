import { useEffect, useRef, useState } from "react";
import { getCell, type MWorld } from "@recursia/sdk";
import { YOU } from "./sandbox";

export function holderHue(holder: string): number {
  let h = 2166136261;
  for (let i = 0; i < holder.length; i++) h = Math.imul(h ^ holder.charCodeAt(i), 16777619);
  return Math.abs(h) % 360;
}

export function holderColor(holder: string | null, alpha = 1): string {
  if (!holder) return `rgba(210, 220, 255, ${alpha})`;
  if (holder === YOU || holder.startsWith("ваш-")) return `rgba(255, 214, 107, ${alpha})`;
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
}

const SIZE = 640;
const CELL = SIZE / 64;

export function WorldCanvas({ world, selected, onSelect, onDescend, frame, zoomFrom, superposed = [] }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== SIZE * dpr) { c.width = SIZE * dpr; c.height = SIZE * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05040c";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // territory tints
    world.territories.forEach((t, i) => {
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
      if (t.holder) {
        ctx.fillStyle = holderColor(t.holder, t.holder === YOU ? 0.13 : 0.08);
        ctx.fillRect(tx, ty, 8 * CELL, 8 * CELL);
      }
    });

    // cells
    const owners = world.territories.map((t) => t.holder);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (!getCell(world.grid, x, y)) continue;
        const idx = (y >> 3) * 8 + (x >> 3);
        ctx.fillStyle = holderColor(owners[idx], 0.95);
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      }
    }
    // glow pass
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = "blur(4px)";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(c, 0, 0, SIZE * dpr, SIZE * dpr, 0, 0, SIZE, SIZE);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // territory grid
    ctx.strokeStyle = "rgba(140, 150, 255, 0.14)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * 8 * CELL + 0.5, 0); ctx.lineTo(i * 8 * CELL + 0.5, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 8 * CELL + 0.5); ctx.lineTo(SIZE, i * 8 * CELL + 0.5); ctx.stroke();
    }

    // child universes: nested-square portals
    const pulse = 0.5 + 0.5 * Math.sin(frame / 3);
    world.territories.forEach((t, i) => {
      if (!t.childWorld) return;
      const tx = (i % 8) * 8 * CELL, ty = Math.floor(i / 8) * 8 * CELL;
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
  }, [world, world.generation, selected, hover, frame, superposed.join(",")]);

  const idxAt = (e: React.MouseEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return Math.max(0, Math.min(63, y * 8 + x));
  };

  const origin = zoomFrom !== null ? `${((zoomFrom % 8) + 0.5) * 12.5}% ${(Math.floor(zoomFrom / 8) + 0.5) * 12.5}%` : "50% 50%";
  return (
    <div className="canvas-wrap">
      <canvas
        key={world.id}
        ref={ref}
        className={zoomFrom !== null ? "world-canvas zoom-in" : "world-canvas"}
        style={{ transformOrigin: origin }}
        onMouseMove={(e) => setHover(idxAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSelect(idxAt(e))}
        onDoubleClick={(e) => { const t = world.territories[idxAt(e)]; if (t.childWorld) onDescend(t.childWorld); }}
      />
      {hover !== null && (
        <div className="hover-tip">
          #{hover} · {world.alive[hover]} клеток · {world.territories[hover].holder ?? "свободна"}
          {world.territories[hover].childWorld ? " · ⧉ вселенная (двойной клик)" : ""}
        </div>
      )}
    </div>
  );
}
