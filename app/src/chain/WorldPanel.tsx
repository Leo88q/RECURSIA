import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { BREACH_RESONANCE, REBELLION_MIN_VOTES, ruleString } from "@recursia/sdk";
import { rcr, slotsToHuman } from "../lib/format";
import { worldEpochClaimable } from "../lib/epoch";
import { AmountField, Address, amountOf } from "../ui/fields";
import { blocked, type ChainCtx } from "./ctx";
import { Art, Glyph, WorldIcon } from "../ui/Icon";

export function WorldPanel({ c }: { c: ChainCtx }) {
  const { cur, config, me } = c;
  const [fund, setFund] = useState("100");
  if (!cur) return <div className="panel-body muted">Выберите мир</div>;
  const w = cur.acc, k = cur.key, p = config.params;
  const def = PublicKey.default;
  const hasArchitect = !w.architect.equals(def);
  const pop = w.territoryAlive.reduce((a, b) => a + b, 0);
  const nextTick = Number(w.lastTickSlot + p.tickIntervalSlots) - c.slot;
  const parent = w.parent.equals(def) ? null : w.parent;
  const parentName = parent ? c.data.worlds.find((x) => x.key.equals(parent))?.acc.name : null;
  const f = amountOf(fund);
  const ticksLeft = p.tickCost > 0n ? Number(w.energy / p.tickCost) : 0;
  const rebellionActive = BigInt(c.slot) <= w.rebellionDeadline && w.rebellionId > 0;
  const epochClaimable = worldEpochClaimable(w, config.curEpoch);
  return (
    <div className="panel-body">
      <div className="kv-head">
        <div className="title"><WorldIcon neutral={w.neutral} depth={w.depth} size={26} />{w.name}</div>
        {w.liberated && !w.neutral && <span className="tag free">свободен</span>}
        {w.neutral && <span className="tag quantum">нейтральный</span>}
      </div>
      <dl className="kv">
        <dt>Адрес</dt><dd><Address value={k.toBase58()} /></dd>
        <dt>Физика</dt><dd className="mono">{ruleString(w.birth, w.survive, w.qBirth, w.qSurvive, w.qAmp)}</dd>
        <dt>Архитектор</dt><dd>{hasArchitect ? <><Address value={w.architect.toBase58()} /> · {w.architectFeeBps / 100}%</> : "нет"}</dd>
        {parent && <><dt>Внутри</dt><dd><button className="linkish" onClick={() => c.openWorld(parent.toBase58(), w.parentTerritory)}>{parentName ?? "мир"} #{w.parentTerritory}</button></dd></>}
        <dt>Глубина</dt><dd>{w.depth}</dd>
        <dt>Поколение</dt><dd>{w.generation.toLocaleString("ru-RU")}</dd>
        <dt>Население</dt><dd>{pop.toLocaleString("ru-RU")} клеток</dd>
        <dt>Энергия</dt><dd>{rcr(w.energy)} <span className="muted">(~{ticksLeft} тиков)</span></dd>
        <dt>Резонанс</dt><dd>{w.resonance} / {BREACH_RESONANCE}</dd>
        <dt>Сожжено</dt><dd>{rcr(w.totalBurned, 0)}</dd>
      </dl>

      <div className="card">
        <div className="card-title"><Glyph name="clock" size={17} />Время мира</div>
        <p className="muted small">Мир живёт только когда кто-то «тикает» его. Тик стоит {rcr(p.tickCost)} из энергии мира; кранкер получает {p.crankerBps / 100}%.</p>
        <button className="btn primary" disabled={nextTick > 0 || w.energy < p.tickCost || !!blocked(c)} onClick={() => c.run({
          title: "Тик мира", lines: [`Мир «${w.name}»: +${p.gensPerTick} поколения`, `Стоимость ${rcr(p.tickCost)} из энергии мира`, `Ваша награда: ${rcr(p.tickCost * BigInt(p.crankerBps) / 10_000n, 4)}`],
          ixs: c.withAta([c.rx.tick(me!, k, w.module, parent)]), successText: "Мир сделал шаг",
        })}>{nextTick > 0 ? `Тик через ${slotsToHuman(nextTick)}` : w.energy < p.tickCost ? "Нет энергии" : "Тикнуть мир"}</button>
        <AmountField label="Пополнить энергию" value={fund} onChange={setFund} max={c.my.rcr ?? undefined} />
        <button className="btn" disabled={f === null || !!blocked(c, { spend: f ?? 0n })} onClick={() => c.run({ title: "Пополнение энергии мира", lines: [`+${rcr(f!)} энергии миру «${w.name}»`, "Энергия безвозвратно тратится на тики"], ixs: [c.rx.fundWorld(me!, k, f!)] })}>Пополнить</button>
      </div>

      <div className="card">
        <div className="card-title"><Glyph name="clock" size={17} className="gold" />Эпоха {config.curEpoch.toString()}</div>
        <p className="muted small">По окончании эпохи мир забирает свою долю эмиссии пропорционально сожжённому; она распределяется между живыми клетками. Вызвать может любой.</p>
        <button className="btn" disabled={!epochClaimable || !me} onClick={() => c.run({ title: "Эмиссия эпохи для мира", lines: [`Мир «${w.name}» получает долю пула наград за прошлую эпоху`], ixs: [c.rx.claimWorldEpoch(k)] })}>Забрать эмиссию мира</button>
      </div>

      {me && hasArchitect && w.architect.equals(me) && (
        <div className="card">
          <div className="card-title"><Art name="architect" size={21} />Вы — архитектор</div>
          <div className="small">Накоплено: <b>{rcr(w.architectAccrued)}</b></div>
          <button className="btn" disabled={w.architectAccrued === 0n} onClick={() => c.run({ title: "Доход архитектора", lines: [`${rcr(w.architectAccrued)} → ваш баланс к выводу`], ixs: [c.rx.claimArchitect(me, k)] })}>Забрать</button>
        </div>
      )}
      {rebellionActive && hasArchitect && (
        <div className="card danger-card">
          <div className="card-title"><Art name="rebel" size={22} />Восстание #{w.rebellionId}</div>
          <div className="small">Голосов: {w.rebellionVotes} (нужно ≥⅔ владельцев и не меньше {REBELLION_MIN_VOTES})</div>
          <button className="btn danger" disabled={!me} onClick={() => c.run({ title: "Исполнить восстание", lines: [`Мир «${w.name}» становится свободным навсегда`, "Накопления архитектора уходят ему на вывод, комиссия обнуляется"], ixs: [c.rx.executeRebellion(me!, k, w.architect)] })}>Исполнить</button>
        </div>
      )}
      {parent && w.resonance >= BREACH_RESONANCE && (
        <div className="card">
          <div className="card-title"><Art name="breach" size={22} />Прорыв</div>
          <p className="small">Вложенный мир накопил резонанс: его жизнь может «просочиться» в клетку-хост родителя.</p>
          <button className="btn portal" disabled={!me} onClick={() => c.run({ title: "Прорыв в родительский мир", lines: [`«${w.name}» → ${parentName ?? "родитель"} #${w.parentTerritory}`], ixs: [c.rx.breach(k, parent)] })}>Прорыв</button>
        </div>
      )}
    </div>
  );
}
