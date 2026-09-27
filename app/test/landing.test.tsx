// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Landing } from "../src/Landing";

describe("landing", () => {
  const html = renderToStaticMarkup(<Landing go={() => {}} />);
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  it("has every section a new player needs", () => {
    for (const id of ["sec-about", "sec-start", "sec-price", "sec-rules", "sec-safety", "sec-faq"]) expect(html).toContain(`id="${id}"`);
    for (const t of ["Как начать играть", "Сколько стоит вход", "Правила игры", "Частые вопросы", "Налог Харбергера", "Квантовый слой", "SWAP", "Восстание", "Дочерние миры", "Прорыв", "Лаборатория", "ИИ-жители", "Эпохи и награды"]) expect(text).toContain(t);
  });
  it("philosophy and rules are illustrated; every image is lazy, sized and described", () => {
    expect(html).toContain('id="sec-philosophy"');
    for (const t of ["Философия игры", "Мир внутри мира", "Сложность из простоты", "Будущее не написано", "Правила в картинках"]) expect(text).toContain(t);
    const illos = [...html.matchAll(/<img class="l-illo[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(illos.length).toBe(9); // 3 philosophy + 6 rule cards
    for (const tag of illos) {
      expect(tag).toMatch(/loading="lazy"/);
      expect(tag).toMatch(/width="\d+" height="\d+"/); // no layout shift
      expect(tag).toMatch(/alt="[^"]{20,}"/); // meaningful alt text, not decorative
    }
    // each "Подробнее" button opens a rule that exists
    for (const m of html.matchAll(/aria-controls="(rule-[a-z]+)"/g)) expect(html).toContain(`id="${m[1]}"`);
    expect([...html.matchAll(/aria-controls="rule-/g)].length).toBe(6);
  });
  it("states the entry cost computed from the protocol params", () => {
    expect(text).toMatch(/от 15,05 RCR/);
    expect(text).toMatch(/до 0,00538 SOL/);
    expect(text).toContain("1 000 000 000 RCR"); // supply shown in full, not divided twice
    expect(text).not.toMatch(/Всего 1 000 RCR/);
    expect(text).toMatch(/Итого 15,05 RCR/);
  });
  it("is honest about risk and never asks for a seed phrase", () => {
    expect(text).toContain("Внешний аудит контракта ещё не проведён");
    expect(text).toMatch(/не является инвестиционной рекомендацией/);
    expect(html).not.toMatch(/<input|<textarea/);
  });
  it("external links are safe", () => {
    for (const m of html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) expect(m[0]).toMatch(/rel="noopener noreferrer"/);
  });
  it("does not pull the simulator or web3.js into the landing module graph", () => {
    const src = readFileSync(join(__dirname, "../src/Landing.tsx"), "utf8") + readFileSync(join(__dirname, "../src/lib/costs.ts"), "utf8");
    expect(src).not.toMatch(/from "\.\/sandbox"|SandboxView|@solana\/web3\.js|WORLD_SPACE,/);
  });
});
