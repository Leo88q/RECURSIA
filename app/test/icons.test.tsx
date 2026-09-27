// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ART, Art, Glyph, WorldIcon } from "../src/ui/Icon";

const SRC = join(__dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("icon system", () => {
  it("every painted icon resolves to a bundled asset", () => {
    for (const [name, url] of Object.entries(ART)) expect(url, name).toMatch(/\.webp/);
    for (const f of ["logo", "world", "nested", "neutral", "quantum", "lab", "coin", "bg", "hero"]) {
      const size = statSync(join(SRC, "assets/art", `${f}.webp`)).size;
      expect(size, f).toBeGreaterThan(1_000);
      expect(size, f).toBeLessThan(160 * 1024);
    }
  });

  it("icons are decorative by default and labelled when titled", () => {
    const a = renderToStaticMarkup(<Art name="coin" />);
    expect(a).toContain('alt=""'); expect(a).toContain('aria-hidden="true"');
    const t = renderToStaticMarkup(<Art name="quantum" title="квантовые законы" />);
    expect(t).toContain('alt="квантовые законы"'); expect(t).not.toContain("aria-hidden");
    const g = renderToStaticMarkup(<Glyph name="agent" />);
    expect(g).toContain("<svg"); expect(g).toContain('aria-hidden="true"'); expect(g).toContain('focusable="false"');
    expect(renderToStaticMarkup(<Glyph name="agent" title="ИИ" />)).toContain('role="img"');
  });

  it("world icon follows the world kind", () => {
    expect(renderToStaticMarkup(<WorldIcon neutral depth={0} />)).toContain(ART.neutral);
    expect(renderToStaticMarkup(<WorldIcon neutral={false} depth={2} />)).toContain(ART.nested);
    expect(renderToStaticMarkup(<WorldIcon neutral={false} depth={0} />)).toContain(ART.world);
  });

  // Emoji / rare symbols render as tofu (□) on systems without the font — the logo "⧉"
  // and pause "⏸" did exactly that. UI chrome must use <Art>/<Glyph>; plain text lines
  // (tx previews, chronicle strings) may still use common typographic arrows.
  it("no emoji-icons in JSX", () => {
    const banned = /[⧉◈⚖⚗🤖⚡✊👁⬇⬆🌌🧬🔭📜✎⚑⏸⚠✓✗↗]/u;
    const offenders: string[] = [];
    for (const f of walk(SRC).filter((p) => p.endsWith(".tsx"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (banned.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(`${f.slice(SRC.length)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
