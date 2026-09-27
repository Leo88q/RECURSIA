// "Лаборатория физики": design quantum laws, preview them, publish them as a
// PhysicsModule and earn royalty from every tick of every world that runs them.
// Validation mirrors the contract (lawError) — the program re-checks anyway.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bigbang, encodeName, lawError, lawString, mutateLaw, parseLaw, population, probeLaw, stepNQ, MAX_ROYALTY_BPS, Rng,
  type Law, type Quantum,
} from "@recursia/sdk";
import { Art, Glyph } from "./ui/Icon";

export interface LabModule {
  id: number; name: string; author: string; law: Law; worldsUsing: number; earned: bigint; accrued: bigint; vitality: number; mine: boolean;
}

interface Props {
  modules: LabModule[];
  fee: bigint;
  feeBurnBps: number;
  fmt: (v: bigint) => string;
  /** returns an error text or null */
  onPublish: (law: Law, name: string) => Promise<string | null> | string | null;
  onClaim?: (id: number) => void;
  onUse?: (id: number) => void;
  note?: string;
}

const ROWS: Array<[keyof Law, string, string]> = [
  ["birth", "B", "рождение — пустая клетка оживает при N соседях"],
  ["survive", "S", "выживание — живая клетка остаётся при N соседях"],
  ["qBirth", "qB", "квантовое рождение — срабатывает с вероятностью p"],
  ["qSurvive", "qS", "квантовое выживание — срабатывает с вероятностью p"],
];
const VERDICT_CLASS: Record<string, string> = { "жизнь": "ok", "стазис": "meh", "хаос": "meh", "вымирание": "bad", "взрыв": "bad" };

export function PhysicsLab({ modules, fee, feeBurnBps, fmt, onPublish, onClaim, onUse, note }: Props) {
  const [law, setLaw] = useState<Law>({ birth: 1 << 3, survive: (1 << 2) | (1 << 3), qBirth: 1 << 6, qSurvive: 0, qAmp: 1, royaltyBps: 250 });
  const [name, setName] = useState("Моя физика");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null);
  const rng = useRef(new Rng(Date.now() & 0xffff));

  const err = lawError(law);
  const nameErr = (() => { try { encodeName(name); return name.trim() ? null : "пустое имя"; } catch (e) { return (e as Error).message; } })();
  const duplicate = modules.find((m) => m.law.birth === law.birth && m.law.survive === law.survive && m.law.qBirth === law.qBirth && m.law.qSurvive === law.qSurvive && m.law.qAmp === law.qAmp);
  const probe = useMemo(() => (err ? null : probeLaw(law, 96, 3)), [law.birth, law.survive, law.qBirth, law.qSurvive, law.qAmp, err]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (row: keyof Law, n: number) => setLaw((l) => {
    const next = { ...l, [row]: (l[row] as number) ^ (1 << n) };
    // keep amp consistent while editing so the preview stays meaningful
    if ((next.qBirth | next.qSurvive) === 0) next.qAmp = 0; else if (next.qAmp === 0) next.qAmp = 1;
    return next;
  });
  const applyText = () => {
    const p = parseLaw(text);
    if (!p) { setMsg({ t: "Не распознано. Пример: B36/S23/qB7/a2", bad: true }); return; }
    setLaw((l) => ({ ...l, ...p })); setMsg(null);
  };
  const publish = async () => {
    setBusy(true);
    try {
      const e = await onPublish(law, name.trim());
      setMsg(e ? { t: e, bad: true } : { t: `«${name}» опубликована: вы автор, роялти ${law.royaltyBps / 100}% с каждого тика навсегда`, bad: false });
    } finally { setBusy(false); }
  };

  return (
    <div className="lab">
      <section className="lab-col">
        <div className="panel-title"><Art name="lab" size={20} />Редактор законов</div>
        <p className="muted small">Классика Конвея — <b>B3/S23</b>. Квантовые правила срабатывают не всегда, а с вероятностью p, и определяются энтропией блокчейна — будущее такого мира нельзя просчитать заранее.</p>
        <table className="rule-grid">
          <thead><tr><th />{[...Array(9).keys()].map((n) => <th key={n}>{n}</th>)}</tr></thead>
          <tbody>
            {ROWS.map(([row, label, hint]) => (
              <tr key={row} title={hint}>
                <th className={row.startsWith("q") ? "q" : ""}>{label}</th>
                {[...Array(9).keys()].map((n) => {
                  const on = ((law[row] as number) >> n) & 1;
                  const clash = row === "qBirth" ? (law.birth >> n) & 1 : row === "qSurvive" ? (law.survive >> n) & 1 : 0;
                  const forbidden = (row === "birth" || row === "qBirth") && n === 0;
                  return <td key={n}><button className={`rc ${on ? "on" : ""} ${row.startsWith("q") ? "q" : ""} ${on && clash ? "clash" : ""} ${forbidden ? "forbid" : ""}`} onClick={() => toggle(row, n)}>{on ? "●" : ""}</button></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <label className="field">Амплитуда квантовых правил: p = {["—", "½", "¼", "⅛"][law.qAmp]}
          <input type="range" min={0} max={3} value={law.qAmp} onChange={(e) => setLaw({ ...law, qAmp: Number(e.target.value) })} />
        </label>
        <div className="row-wrap">
          <input className="mono" placeholder="B36/S23/qB7/a2" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyText()} />
          <button className="btn" onClick={applyText}>Применить</button>
          <button className="btn" onClick={() => setLaw(mutateLaw(law, rng.current))} title="Случайная допустимая мутация"><Glyph name="dna" size={15} /> Мутировать</button>
        </div>
        <div className="law-string">{lawString(law)}</div>
        {err && <div className="danger-text small"><Glyph name="cross" size={13} /> {err}</div>}
      </section>

      <section className="lab-col">
        <div className="panel-title"><Glyph name="scan" size={17} />Предпросмотр вселенной</div>
        {probe ? <>
          <LawPreview law={law} />
          <PopulationCurve curve={probe.curve} />
          <div className="row-wrap">
            <span className={`verdict ${VERDICT_CLASS[probe.verdict]}`}>{probe.verdict}</span>
            <span className="small">плотность {(probe.finalDensity * 100).toFixed(1)}% · активность {(probe.activity * 100).toFixed(2)}%</span>
          </div>
          <div className="small">Жизнеспособность {probe.vitality}/100</div>
          <div className="bar"><div style={{ width: `${probe.vitality}%` }} /></div>
          <p className="muted small">ИИ-демиурги выбирают физику для новых миров пропорционально жизнеспособности² — живые законы приносят автору больше роялти.{law.qAmp ? " Для квантовых законов это прогноз: реальное будущее зависит от хешей слотов." : ""}</p>
        </> : <div className="muted small">Исправьте закон, чтобы увидеть предпросмотр.</div>}

        <div className="card">
          <div className="card-title"><Art name="coin" size={20} />Опубликовать ончейн</div>
          <label className="field">Название<input value={name} maxLength={28} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">Роялти автора: {(law.royaltyBps / 100).toFixed(1)}% каждого тика (неизменяемо)
            <input type="range" min={0} max={MAX_ROYALTY_BPS} step={25} value={law.royaltyBps} onChange={(e) => setLaw({ ...law, royaltyBps: Number(e.target.value) })} />
          </label>
          <div className="muted small">Регистрация: {fmt(fee)} ({feeBurnBps / 100}% сжигается). Выше роялти — меньше остаётся мирам, и рынок это учтёт.</div>
          {duplicate && <div className="small danger-text">Такой закон уже есть: «{duplicate.name}». Публикация разрешена, но конкурировать придётся ценой роялти.</div>}
          {nameErr && <div className="small danger-text">{nameErr}</div>}
          {note && <div className="muted small">{note}</div>}
          <button className="btn portal" disabled={!!err || !!nameErr || busy} onClick={publish}><Art name="lab" size={20} /> Опубликовать закон · {fmt(fee)}</button>
          {msg && <div className={msg.bad ? "small danger-text" : "small ok-text"}>{msg.t}</div>}
        </div>
      </section>

      <section className="lab-col wide">
        <div className="panel-title"><Art name="law" size={21} />Рынок законов физики</div>
        <table className="market">
          <thead><tr><th>Закон</th><th>Автор</th><th>Миров</th><th>Жизнь</th><th>Роялти</th><th>Заработано</th><th /></tr></thead>
          <tbody>
            {[...modules].sort((a, b) => b.worldsUsing - a.worldsUsing || b.vitality - a.vitality).map((m) => (
              <tr key={m.id} className={m.mine ? "mine" : ""}>
                <td><b>{m.name}</b><div className="muted mono tiny">{lawString(m.law)}</div></td>
                <td className="small">{m.author}</td>
                <td>{m.worldsUsing}</td>
                <td><div className="bar thin"><div style={{ width: `${m.vitality}%` }} /></div></td>
                <td>{(m.law.royaltyBps / 100).toFixed(1)}%</td>
                <td className="small">{fmt(m.earned + m.accrued)}</td>
                <td className="actions">
                  <button className="chip" title="Скопировать в редактор" onClick={() => { setLaw({ ...m.law }); setName(`${m.name.slice(0, 20)}′`); }}><Glyph name="edit" size={14} /></button>
                  {onUse && <button className="chip" title="Выбрать для новой вселенной" onClick={() => onUse(m.id)}><Art name="nested" size={16} /></button>}
                  {m.mine && m.accrued > 0n && onClaim && <button className="chip on" onClick={() => onClaim(m.id)}>Забрать {fmt(m.accrued)}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Live mini-universe running the law being edited (preview seeds). */
function LawPreview({ law }: { law: Law }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let g = bigbang(new Uint8Array(32).fill(7));
    let gen = 0n;
    const q: Quantum | null = law.qAmp && (law.qBirth | law.qSurvive) ? { qBirth: law.qBirth, qSurvive: law.qSurvive, amp: law.qAmp, seed: [11n, 22n, 33n, 44n] } : null;
    const draw = () => {
      const c = ref.current?.getContext("2d"); if (!c) return;
      c.fillStyle = "#07091a"; c.fillRect(0, 0, 192, 192);
      c.fillStyle = q ? "#b98cff" : "#7cf7d4";
      for (let y = 0; y < 64; y++) { const row = g[y]; if (!row) continue; for (let x = 0; x < 64; x++) if ((row >> BigInt(x)) & 1n) c.fillRect(x * 3, y * 3, 3, 3); }
    };
    draw();
    const i = setInterval(() => {
      g = stepNQ(g, law.birth, law.survive, q, gen, 1); gen++;
      if (population(g) === 0 && gen > 4n) { g = bigbang(new Uint8Array(32).fill(Number(gen % 250n))); }
      draw();
    }, 110);
    return () => clearInterval(i);
  }, [law.birth, law.survive, law.qBirth, law.qSurvive, law.qAmp]);
  return <canvas ref={ref} width={192} height={192} className="lab-canvas" />;
}

function PopulationCurve({ curve }: { curve: number[] }) {
  const max = Math.max(0.05, ...curve);
  const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * 240},${60 - (v / max) * 56}`).join(" ");
  return (
    <svg viewBox="0 0 240 62" className="curve">
      <polyline points={pts} fill="none" stroke="#7cf7d4" strokeWidth="1.5" />
      <text x="2" y="10" className="curve-label">{(max * 100).toFixed(0)}%</text>
      <text x="200" y="60" className="curve-label">{curve.length - 1} пок.</text>
    </svg>
  );
}
