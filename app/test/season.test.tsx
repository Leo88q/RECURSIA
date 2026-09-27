// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SeasonCard } from "../src/ui/Season";
import { Landing } from "../src/Landing";

const fmt = (v: bigint) => `${v} SKR`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("season UI", () => {
  it("shows the leaderboard, highlights you, and offers unclaimed prizes only", () => {
    const html = renderToStaticMarkup(
      <SeasonCard seasonId={3} epochsLeft={2} pool={1000n} myPoints={40n} submitBlocked={null} onSubmit={() => {}}
        top={[{ label: "ИИ·Садовник-1", points: 90n, you: false }, { label: "Вы", points: 40n, you: true }]}
        last={{ id: 2, rows: [
          { label: "A", points: 100n, you: false, prize: 25n, claimed: true },
          { label: "Вы", points: 60n, you: true, prize: 15n, claimed: false },
          { label: "—", points: 0n, you: false, prize: 0n, claimed: false },
        ] }}
        onClaim={() => {}} claimBlocked={null} fmt={fmt} />,
    );
    const t = text(html);
    expect(t).toContain("Сезон 3");
    expect(t).toContain("1000 SKR");
    expect(t).toContain("2 эп.");
    expect(t).toContain("Обновить очки в таблице"); // already in the top
    expect(html).toContain('class="you"');
    expect(t).toContain("Призы сезона 2");
    expect(t).toContain("+15 SKR"); // claimable
    expect(t).not.toContain("+25 SKR"); // already paid → shown as done, no button
    expect(html.match(/<li[\s>]/g)!.length).toBe(4); // 2 leaderboard + 2 prize rows (zero prize hidden)
  });

  it("the landing explains sponsors & seasons with contract numbers", () => {
    const t = text(renderToStaticMarkup(<Landing go={() => {}} />));
    expect(t).toContain("Спонсоры и сезоны");
    expect(t).toMatch(/Сезон длится 7 эпох/);
    expect(t).toMatch(/Топ-10 делит фонд: 30% \/ 20% \/ 15%/);
    expect(t).toMatch(/не может быть больше 25% ваших очков/);
    expect(t).toContain("fund_sponsor_pool");
    expect(t).toMatch(/Доля за эффективность\s*\(30%\)/);
    expect(t).toMatch(/не больше 200% его вклада/);
    expect(t).toMatch(/Турниры\. В первую эпоху сезона/);
    expect(t).toMatch(/лучшие 30% участников/);
  });
});
