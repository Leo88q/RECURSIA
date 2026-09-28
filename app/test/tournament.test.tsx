// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentCard, type TierView } from "../src/ui/Tournament";
import { plantAdvice } from "../src/lib/advice";

const fmt = (v: bigint) => `${v} SKR`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const tier = (o: Partial<TierView>): TierView => ({
  tier: 0, fee: 700n, players: 9, max: 40, pot: 5670n, joined: false, paidPlaces: 3, top: [], joinBlocked: null, submitBlocked: null, ...o,
});
const noop = () => {};

describe("planting advice (client preview, never a contract limit)", () => {
  it("warns about plantings that die or don't help", () => {
    expect(plantAdvice(0, 0, 5).level).toBe("danger");
    expect(plantAdvice(3, 3, 7).level).toBe("warn");
    expect(plantAdvice(0, 9, 2).level).toBe("warn"); // quantum spread incl. extinction
    expect(plantAdvice(8, 8, 2).level).toBe("ok");
    expect(plantAdvice(0, 0, 0).text).toMatch(/вымрет/);
  });
});

describe("tournament UI", () => {
  it("shows fee, pot, paid places and a join button while registration is open", () => {
    const t = text(renderToStaticMarkup(
      <TournamentCard seasonId={4} joinOpen tiers={[tier({}), tier({ tier: 1, fee: 7000n, players: 0, pot: 0n, paidPlaces: 0 })]} finished={[]}
        onJoin={noop} onSubmit={noop} onSettle={noop} onClaim={noop} actionBlocked={null} fmt={fmt} />,
    ));
    expect(t).toContain("Турниры сезона 4");
    expect(t).toContain("взнос 700 SKR · 9/40 игроков · банк 5670 SKR · призовых мест 3");
    expect(t).toContain("Участвовать · 700 SKR");
    expect(t).toContain("Участвовать · 7000 SKR");
    expect(t).toMatch(/лучшие 30%/);
    expect(t).toMatch(/10% берёт студия/);
  });

  it("an entrant sees the standings and can update points; closed registration is explained", () => {
    const html = renderToStaticMarkup(
      <TournamentCard seasonId={4} joinOpen={false}
        tiers={[tier({ joined: true, top: [{ label: "ИИ-1", points: 90n, you: false }, { label: "Вы", points: 40n, you: true }] }), tier({ tier: 1, joinBlocked: "Регистрация закрыта до следующего сезона" })]}
        finished={[]} onJoin={noop} onSubmit={noop} onSettle={noop} onClaim={noop} actionBlocked={null} fmt={fmt} />,
    );
    const t = text(html);
    expect(t).toContain("Обновить мои очки");
    expect(t).toContain("Регистрация закрыта до следующего сезона");
    expect(html).toContain('class="you"');
  });

  it("finished tournaments: settle first, then only unclaimed prizes are buttons", () => {
    const rows = [
      { label: "A", points: 100n, you: false, prize: 300n, claimed: true },
      { label: "Вы", points: 60n, you: true, prize: 200n, claimed: false },
      { label: "—", points: 0n, you: false, prize: 0n, claimed: false },
    ];
    const t1 = text(renderToStaticMarkup(
      <TournamentCard seasonId={5} joinOpen tiers={[]} finished={[{ seasonId: 4, tier: 0, settled: false, pot: 500n, rows }]}
        onJoin={noop} onSubmit={noop} onSettle={noop} onClaim={noop} actionBlocked={null} fmt={fmt} />,
    ));
    expect(t1).toContain("Подвести итоги · банк 500 SKR");
    const html = renderToStaticMarkup(
      <TournamentCard seasonId={5} joinOpen tiers={[]} finished={[{ seasonId: 4, tier: 0, settled: true, pot: 200n, rows }]}
        onJoin={noop} onSubmit={noop} onSettle={noop} onClaim={noop} actionBlocked={null} fmt={fmt} />,
    );
    const t2 = text(html);
    expect(t2).toContain("+200 SKR");
    expect(t2).not.toContain("+300 SKR");
    expect(html.match(/<li[\s>]/g)!.length).toBe(2);
  });
});
