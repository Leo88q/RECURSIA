import { useMemo, useState } from "react";
import { MAX_ARCHITECT_FEE_BPS, encodeName, probeLaw, ruleString } from "@recursia/sdk";
import { rcr } from "../lib/format";
import { Modal } from "../ui/Modal";
import { AmountField, amountOf } from "../ui/fields";
import { blocked, type ChainCtx } from "./ctx";
import { Art } from "../ui/Icon";

type Kind = "root" | "child" | "neutral";
const TITLE: Record<Kind, string> = { root: "Новая корневая вселенная", child: "Вселенная внутри клетки", neutral: "Нейтральный квантовый мир" };
const BTN: Record<Kind, React.ReactNode> = {
  root: <><Art name="world" size={20} /> Создать вселенную</>,
  child: <><Art name="nested" size={20} /> Запустить вселенную в клетке</>,
  neutral: <><Art name="neutral" size={20} /> Открыть нейтральный мир</>,
};

export function CreateWorldButton({ c, kind, hostIndex }: { c: ChainCtx; kind: Kind; hostIndex?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={kind === "child" ? "btn portal" : "btn"} onClick={() => setOpen(true)} disabled={!c.me}>{BTN[kind]}</button>
      {open && <CreateWorldModal c={c} kind={kind} hostIndex={hostIndex} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateWorldModal({ c, kind, hostIndex, onClose }: { c: ChainCtx; kind: Kind; hostIndex?: number; onClose: () => void }) {
  const p = c.config.params;
  const mods = useMemo(() => c.data.modules
    .filter((m) => kind !== "neutral" || (m.acc.qAmp > 0 && (m.acc.qBirth | m.acc.qSurvive) !== 0))
    .map((m) => ({ ...m, vitality: probeLaw(m.acc, 48, 2).vitality }))
    .sort((a, b) => b.vitality - a.vitality), [c.data.modules, kind]);
  const [mod, setMod] = useState(() => mods[0]?.key.toBase58() ?? "");
  const [name, setName] = useState(kind === "neutral" ? "Нейтральная зона" : kind === "child" ? "Карманная вселенная" : "Новый космос");
  const [fee, setFee] = useState(500);
  const [energy, setEnergy] = useState("200");
  const e = amountOf(energy, { min: p.tickCost });
  const nameErr = (() => { try { encodeName(name); return null; } catch { return "имя 1..32 байта"; } })();
  const m = mods.find((x) => x.key.toBase58() === mod);
  const total = e !== null ? p.worldCreateFee + e : null;
  const why = blocked(c, { spend: total ?? 0n }) ?? (!m ? "Выберите законы физики" : nameErr ?? (e === null ? "Проверьте энергию" : null));
  const submit = async () => {
    const me = c.me!;
    const { ix, world: target } = kind === "root" ? c.rx.createRootWorld(me, c.config.rootWorlds, m!.key, fee, name.trim(), e!)
      : kind === "neutral" ? c.rx.createNeutralWorld(me, c.config.rootWorlds, m!.key, name.trim(), e!)
      : c.rx.createChildWorld(me, c.cur!.key, hostIndex!, m!.key, fee, name.trim(), e!);
    const r = await c.run({
      title: TITLE[kind],
      lines: [
        `«${name.trim()}» · физика «${m!.acc.name}» ${ruleString(m!.acc.birth, m!.acc.survive, m!.acc.qBirth, m!.acc.qSurvive, m!.acc.qAmp)}`,
        ...(kind === "neutral" ? ["Без архитектора, навсегда свободен; открыт рынок квантовых SWAP"] : [`Ваша комиссия архитектора: ${fee / 100}% с каждого тика`]),
        ...(kind === "child" ? [`Живёт внутри клетки #${hostIndex} мира «${c.cur!.acc.name}»; спит, если клетка-хост мертва`] : []),
        `Сбор создания: ${rcr(p.worldCreateFee)} (${p.feeBurnBps / 100}% сжигается)`, `Стартовая энергия: ${rcr(e!)}`,
        ...(m!.acc.royaltyBps > 0 ? [`Роялти автору законов: ${m!.acc.royaltyBps / 100}% тиков`] : []),
      ],
      ixs: [ix], successText: "Вселенная создана",
    });
    if (r.ok) { onClose(); c.openWorld(target.toBase58()); }
  };
  return (
    <Modal title={TITLE[kind]} onClose={onClose}>
      <label className="field">Название<input value={name} onChange={(ev) => setName(ev.target.value)} maxLength={40} aria-invalid={!!nameErr} data-autofocus /></label>
      {nameErr && <div className="field-err">{nameErr}</div>}
      <label className="field">Законы физики
        <select value={mod} onChange={(ev) => setMod(ev.target.value)}>
          {mods.length === 0 && <option value="">{kind === "neutral" ? "нет квантовых модулей — опубликуйте в Лаборатории" : "нет модулей"}</option>}
          {mods.map((x) => <option key={x.key.toBase58()} value={x.key.toBase58()}>«{x.acc.name}» {ruleString(x.acc.birth, x.acc.survive, x.acc.qBirth, x.acc.qSurvive, x.acc.qAmp)} · жизнь {x.vitality} · роялти {x.acc.royaltyBps / 100}%</option>)}
        </select>
      </label>
      {kind !== "neutral" && (
        <label className="field">Комиссия архитектора: {fee / 100}%
          <input type="range" min={0} max={MAX_ARCHITECT_FEE_BPS} step={100} value={fee} onChange={(ev) => setFee(Number(ev.target.value))} />
          <span className="field-hint">Жадный архитектор рискует восстанием: ⅔ жителей могут освободить мир.</span>
        </label>
      )}
      <AmountField label="Стартовая энергия" value={energy} onChange={setEnergy} min={p.tickCost} hint={e !== null ? `≈ ${Number(e / p.tickCost)} тиков` : undefined} />
      <div className="small">Итого: <b>{total !== null ? rcr(total) : "—"}</b></div>
      {why && <div className="field-hint">{why}</div>}
      <div className="row-wrap modal-actions">
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!!why} onClick={submit}>Создать</button>
      </div>
    </Modal>
  );
}
