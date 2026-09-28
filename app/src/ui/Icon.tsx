import type { CSSProperties } from "react";
import logo from "../assets/art/logo.webp";
import world from "../assets/art/world.webp";
import nested from "../assets/art/nested.webp";
import neutral from "../assets/art/neutral.webp";
import quantum from "../assets/art/quantum.webp";
import lab from "../assets/art/lab.webp";
import coin from "../assets/art/coin.webp";
import agent from "../assets/art/agent.webp";
import cell from "../assets/art/cell.webp";
import swap from "../assets/art/swap.webp";
import rebel from "../assets/art/rebel.webp";
import architect from "../assets/art/architect.webp";
import breach from "../assets/art/breach.webp";
import observe from "../assets/art/observe.webp";
import plant from "../assets/art/plant.webp";
import law from "../assets/art/law.webp";
import energy from "../assets/art/energy.webp";

/**
 * Two kinds of icons, one visual language (neon on the void):
 *  - <Art>: painted raster icons (app/src/assets/art, built by scripts/build-art.sh)
 *    for the key game concepts — world kinds, quantum, lab, SKR coin, AI agent, cell,
 *    SWAP, rebellion, architect, breach, observer, planting, laws, energy, the logo.
 *  - <Glyph>: crisp line icons for actions and small UI affordances. They inherit
 *    `currentColor` and get the same glow via CSS, and never fall back to tofu
 *    the way emoji / rare Unicode symbols do on systems without the font.
 * Both are decorative by default (alt="" / aria-hidden) — the adjacent text is the label.
 */
export const ART = { logo, world, nested, neutral, quantum, lab, coin, agent, cell, swap, rebel, architect, breach, observe, plant, law, energy } as const;
export type ArtName = keyof typeof ART;

export function Art({ name, size = 20, className = "", title, style }: { name: ArtName; size?: number; className?: string; title?: string; style?: CSSProperties }) {
  return (
    <img
      src={ART[name]} width={size} height={size} alt={title ?? ""} title={title} aria-hidden={title ? undefined : true}
      className={`art ${className}`} style={style} decoding="async" draggable={false}
    />
  );
}

/** Icon for a world by kind: neutral ⚖ / nested (depth > 0) / root. */
export function WorldIcon({ neutral: isNeutral, depth, size = 18 }: { neutral: boolean; depth: number; size?: number }) {
  return <Art name={isNeutral ? "neutral" : depth > 0 ? "nested" : "world"} size={size} className="world-ico" />;
}

const P: Record<string, string> = {
  // AI agent: rounded helmet, pixel eyes, antenna
  agent: "M8 7h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4ZM12 7V4M12 4h.01M9 12.5h.01M15 12.5h.01M2 12v2M22 12v2M9.5 16h5",
  // cell / land plot: 8×8 tile with a glider
  cell: "M4 4h16v16H4zM4 12h16M12 4v16M8 8h.01M10 10h.01M8 14h.01M10 14h.01M14 10h.01",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  // rebellion: a broken crown (the architect's authority)
  rebel: "M4 18h16M5 15 4 7l4.5 3.5L12 5l1.2 2.1M14.4 9.3 15.5 10.5 20 7l-1 8H5M12.6 8.8l-1.8 2.6",
  energy: "M13 2 5 14h6l-1 8 8-12h-6l1-8Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  dna: "M7 3c0 6 10 6 10 12 0 3-2 5-2 6M17 3c0 6-10 6-10 12 0 3 2 5 2 6M8.5 7h7M8 17h8M9.5 12h5",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9h2v2H9zM13 13h2v2h-2zM13 9h2v2h-2z",
  scroll: "M8 4h10a2 2 0 0 1 2 2v1h-4M8 4a2 2 0 0 0-2 2v12a2 2 0 0 1-2 2h11a2 2 0 0 0 2-2V7M8 4a2 2 0 0 1 2 2M10 10h4M10 14h4",
  edit: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
  pause: "M8 5v14M16 5v14",
  play: "M7 4.5v15L19 12 7 4.5Z",
  step: "M6 5v14l9-7-9-7ZM18 5v14",
  check: "M5 12.5 10 17l9-10",
  cross: "M6 6l12 12M18 6 6 18",
  warn: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  breach: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2 19 19M19 5l-2.8 2.8M7.8 16.2 5 19M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  portal: "M3 3h18v18H3zM7 7h10v10H7zM10.5 10.5h3v3h-3z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  sprout: "M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7ZM12 15c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5ZM7 21h10",
  tag: "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  crown: "M4 18h16M5 15 4 7l4.5 3.5L12 5l3.5 5.5L20 7l-1 8H5Z",
  flow: "M12 3v9l7 4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  flame: "M12 22c4 0 7-2.8 7-6.8 0-3.2-2-5.7-3.6-7.4-.3 1.8-1.3 3-2.6 3.5.3-3.4-1.3-6.6-4.3-8.3.2 3.3-1.6 5.3-3.1 7.1C4.3 11.5 5 13.6 5 15.2 5 19.2 8 22 12 22ZM12 22c-1.7 0-3-1.2-3-3 0-1.6 1.4-2.8 3-4.5 1.6 1.7 3 2.9 3 4.5 0 1.8-1.3 3-3 3Z",
  vault: "M4 5h16v14H4zM4 9h16M9 14h.01M12 14a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
  close: "M6 6l12 12M18 6 6 18",
};
export type GlyphName = keyof typeof P;

export function Glyph({ name, size = 16, className = "", title }: { name: GlyphName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      className={`glyph ${className}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false"
    >
      {name === "play" || name === "energy" ? <path d={P[name]} fill="currentColor" fillOpacity={0.18} /> : <path d={P[name]} />}
    </svg>
  );
}
