// Sandbox onboarding: the "first steps" quest (with do-it-for-me buttons —
// sandbox money is test money) and the rule-based mentor.
import { useMemo, useState } from "react";
import type { Sandbox } from "../sandbox";
import { YOU, fmtRcr } from "../sandbox";
import { mentorTips, recommendFirstCell, safestPattern, tutorialSteps, type Pick, type StepId, type TipLevel } from "../lib/mentor";
import { Glyph, type GlyphName } from "./Icon";

const DONE_KEY = "recursia:tutorial-done:v1";
const fmt = (v: bigint) => fmtRcr(v, 2);
const ICON: Record<TipLevel, GlyphName> = { danger: "warn", warn: "warn", tip: "sprout", ok: "check" };

export function Onboarding({ sb, frame, goCell, setSpeed, notify }: {
  sb: Sandbox; frame: number; goCell: (p: Pick) => void; setSpeed: (s: number) => void; notify: (err: string | null, ok?: string) => void;
}) {
  const m = sb.m;
  const [latched] = useState(() => new Set<StepId>());
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; } });
  const tick = Math.floor(sb.steps / 4); // heavy forecasts: every few simulation steps, not every frame
  const steps = tutorialSteps(m, YOU, latched);
  for (const s of steps) if (s.done) latched.add(s.id);
  const cur = steps.find((s) => !s.done) ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed on the coarse clock
  const rec = useMemo(() => (cur?.id === "acquire" ? recommendFirstCell(m) : null), [cur?.id, tick]);
  const secrets = new Set(sb.secrets.keys());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed on the coarse clock + frame for cheap parts
  const tips = useMemo(() => mentorTips(m, YOU, fmt, secrets), [tick, frame >> 3]);

  const myCells: Pick[] = [];
  for (const w of m.worlds.values()) w.territories.forEach((t, i) => { if (t.holder === YOU) myCells.push({ world: w.id, idx: i }); });
  const run = (f: () => void, ok: string) => { try { f(); notify(null, ok); } catch (e) { notify((e as Error).message); } };

  const action = (() => {
    if (!cur) return null;
    if (cur.id === "acquire") {
      if (!rec) return <div className="muted small">Ищем клетку, где жизнь выживет…</div>;
      const dep = sb.defaultDeposit(m.params.minPrice);
      return (
        <div className="row-wrap">
          <button className="btn" onClick={() => goCell(rec)}>Показать клетку</button>
          <button className="btn primary" onClick={() => run(() => { m.acquire(YOU, rec.world, rec.idx, rec.price, m.params.minPrice, dep); goCell(rec); }, `Клетка #${rec.idx} ваша`)}>
            Занять за {fmt(rec.price + dep)}
          </button>
        </div>
      );
    }
    if (cur.id === "plant") {
      const c = myCells[0];
      if (!c) return null;
      const w = m.world(c.world);
      const safe = safestPattern(w, c.idx);
      const why = m.canPlant(YOU, c.world, c.idx);
      if (!safe) return <div className="muted small">На клетке #{c.idx} соседи не дают жизни выжить — займите другую клетку.</div>;
      return (
        <button className="btn primary" disabled={!!why} title={why ?? ""} onClick={() => run(() => { m.plant(YOU, c.world, c.idx, safe.pattern); goCell(c); }, `Посажен «${safe.label}»`)}>
          <Glyph name="sprout" size={15} /> Посадить «{safe.label}» · {fmt(m.params.plantCost)}
        </button>
      );
    }
    if (cur.id === "earn") return <button className="btn" onClick={() => setSpeed(10)}><Glyph name="play" size={14} /> Ускорить время ×10</button>;
    const best = myCells.map((c) => ({ c, v: m.world(c.world).pending[c.idx] })).sort((a, b) => (b.v > a.v ? 1 : -1))[0];
    if (!best || best.v === 0n) return null;
    return <button className="btn primary" onClick={() => run(() => { m.collect(YOU, best.c.world, best.c.idx); goCell(best.c); }, "Первые SKR собраны")}>Собрать {fmt(best.v)}</button>;
  })();

  return (
    <>
      {!hidden && (
        <div className="card onboarding" aria-label="Первые шаги">
          <div className="card-title"><Glyph name="flag" size={16} /> Первые шаги {steps.filter((s) => s.done).length}/{steps.length}</div>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.id} className={s.done ? "done" : s === cur ? "cur" : ""}>
                <Glyph name={s.done ? "check" : "arrow"} size={13} /> {s.title}
              </li>
            ))}
          </ol>
          {cur ? <><p className="small muted">{cur.hint}</p>{action}</> : (
            <p className="small">Цикл пройден: земля → жизнь → доход → SKR. Дальше — вложенные миры, квантовые суперпозиции и турниры сезона.</p>
          )}
          <button className="linkish small" onClick={() => { setHidden(true); try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ } }}>
            {cur ? "Скрыть обучение" : "Закрыть"}
          </button>
        </div>
      )}
      <div className="card mentor" aria-label="Наставник" aria-live="polite">
        <div className="card-title"><Glyph name="eye" size={16} /> Наставник</div>
        {tips.length === 0 ? <p className="small muted">Сейчас всё спокойно. Наставник подскажет, если депозит заканчивается, посадка обречена или появится выгодная клетка.</p> : (
          <ul className="tips">
            {tips.map((t, i) => (
              <li key={i} className={`tip ${t.level}`}>
                <Glyph name={ICON[t.level]} size={14} />
                {t.at ? <button className="linkish" onClick={() => goCell(t.at!)}>{t.text}</button> : <span>{t.text}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="tiny muted">Правила, а не нейросеть: считает той же симуляцией, что и контракт, ничего не делает сам.</p>
      </div>
    </>
  );
}
