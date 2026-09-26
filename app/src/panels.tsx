import { useMemo, useState } from "react";
import {
  BREACH_RESONANCE, ONE, PATTERNS, REBELLION_MIN_VOTES, REBELLION_THRESHOLD_BPS, cellsFromPattern, epochTax,
  patternFromCells, ruleString, scoreBlockPattern, splitTick, type MWorld, type Personality,
} from "@recursia/sdk";
import { fmtRcr, YOU, type Sandbox } from "./sandbox";
import { holderColor } from "./WorldCanvas";

const toUnits = (s: string) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 1e6)) : 0n; };
const fromUnits = (v: bigint) => (Number(v) / 1e6).toString();

// ------------------------------------------------------------------ world tree
export function WorldTree({ sb, current, onPick }: { sb: Sandbox; current: string; onPick: (id: string) => void }) {
  const roots = [...sb.m.worlds.values()].filter((w) => !w.parent);
  const node = (w: MWorld): React.ReactNode => {
    const status = sb.m.canTick(w.id);
    const pop = w.alive.reduce((a, b) => a + b, 0);
    const spark = w.history.slice(-40);
    const max = Math.max(1, ...spark);
    return (
      <li key={w.id}>
        <button className={`tree-node ${w.id === current ? "active" : ""}`} onClick={() => onPick(w.id)}>
          <span className={`dot ${status === "dormant" ? "dormant" : status === "no energy" ? "dead" : "live"}`} />
          <span className="tree-name">{w.depth > 0 ? "⧉ " : "◈ "}{w.name}</span>
          {w.liberated && <span className="tag free">свободен</span>}
          <svg className="spark" viewBox="0 0 40 12" preserveAspectRatio="none">
            <polyline fill="none" stroke="currentColor" strokeWidth="1" points={spark.map((v, i) => `${i},${12 - (v / max) * 11}`).join(" ")} />
          </svg>
          <span className="tree-pop">{pop}</span>
        </button>
        {w.children.length > 0 && <ul>{w.children.map((c) => node(sb.m.world(c)))}</ul>}
      </li>
    );
  };
  return <ul className="tree">{roots.map(node)}</ul>;
}

// ------------------------------------------------------------------ pattern editor
export function PatternEditor({ world, idx, onPlant, disabledReason }: { world: MWorld; idx: number; onPlant: (p: bigint) => void; disabledReason: string | null }) {
  const [cells, setCells] = useState<boolean[][]>(() => cellsFromPattern(PATTERNS.acorn));
  const pattern = patternFromCells(cells);
  const forecast = useMemo(() => scoreBlockPattern(world.grid, world.birth, world.survive, idx, pattern, 16, 16), [world, world.generation, idx, pattern]);
  const toggle = (r: number, c: number) => setCells((old) => old.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))));
  return (
    <div className="pattern">
      <div className="pattern-grid">
        {cells.map((row, r) => row.map((v, c) => (
          <button key={`${r}-${c}`} className={v ? "pc on" : "pc"} onClick={() => toggle(r, c)} aria-label={`клетка ${r},${c}`} />
        )))}
      </div>
      <div className="pattern-side">
        <div className="presets">
          {Object.entries(PATTERNS).map(([name, p]) => (
            <button key={name} className="chip" onClick={() => setCells(cellsFromPattern(p))}>{PATTERN_NAMES[name] ?? name}</button>
          ))}
          <button className="chip" onClick={() => setCells(cellsFromPattern(0n))}>очистить</button>
        </div>
        <div className="forecast">Прогноз через 16 поколений: <b>{forecast}</b> живых клеток в блоке</div>
        <button className="btn primary" disabled={!!disabledReason} title={disabledReason ?? ""} onClick={() => onPlant(pattern)}>
          Посадить жизнь · 5 RCR (сжигается)
        </button>
        {disabledReason && <div className="muted small">{disabledReason}</div>}
      </div>
    </div>
  );
}
const PATTERN_NAMES: Record<string, string> = { glider: "глайдер", lwss: "корабль", rpentomino: "R-пентамино", block: "блок", acorn: "жёлудь", beacon: "маяк" };

// ------------------------------------------------------------------ territory
export function TerritoryPanel({ sb, world, idx, onDescend, notify }: { sb: Sandbox; world: MWorld; idx: number; onDescend: (id: string) => void; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const t = world.territories[idx];
  const mine = t.holder === YOU;
  const quote = m.quote(world.id, idx);
  const [price, setPrice] = useState(() => fromUnits(quote.price * 2n > m.params.minPrice ? quote.price * 2n : m.params.minPrice));
  const [childName, setChildName] = useState("Моя симуляция");
  const [childModule, setChildModule] = useState(0);
  const [childEnergy, setChildEnergy] = useState("400");
  const [topup, setTopup] = useState("20");
  const newPrice = toUnits(price);
  const deposit = sb.defaultDeposit(newPrice > 0n ? newPrice : m.params.minPrice);
  const taxPerEpoch = epochTax(t.price, m.params.harbergerBps);

  const run = (f: () => unknown, ok: string) => notify(sb.act(f), ok);

  return (
    <div className="panel-body">
      <div className="kv-head">
        <div className="swatch" style={{ background: holderColor(t.holder) }} />
        <div>
          <div className="title">Клетка #{idx}</div>
          <div className="muted small">{world.name} · уровень {world.depth}</div>
        </div>
      </div>
      <dl className="kv">
        <dt>Владелец</dt><dd>{t.holder ? <>{t.holder}{t.agent ? " 🤖" : ""}</> : "свободна"}</dd>
        <dt>Живых клеток</dt><dd>{world.alive[idx]} / 64</dd>
        <dt>Очки эпохи</dt><dd>{world.scoresCur[idx].toLocaleString("ru-RU")}</dd>
        {t.holder && <><dt>Цена (самооценка)</dt><dd>{fmtRcr(t.price)}</dd></>}
        {t.holder && <><dt>Депозит налога</dt><dd>{fmtRcr(t.deposit, 2)} <span className="muted">({fmtRcr(taxPerEpoch, 2)}/эпоху)</span></dd></>}
        <dt>Награды к сбору</dt><dd>{fmtRcr(world.pending[idx], 2)}</dd>
        {t.childWorld && <><dt>Внутри</dt><dd>⧉ {m.world(t.childWorld).name}</dd></>}
      </dl>

      {t.childWorld && <button className="btn portal" onClick={() => onDescend(t.childWorld!)}>Войти в симуляцию ⧉ →</button>}

      {!mine && (
        <div className="card">
          <div className="card-title">{t.holder ? "Выкупить по налогу Харбергера" : "Занять клетку"}</div>
          <p className="muted small">
            {t.holder
              ? `Владелец обязан продать по своей цене. Вы платите ${fmtRcr(quote.price)} — цена зафиксирована как лимит (защита от фронтраннинга).`
              : `Свободная клетка стоит ${fmtRcr(quote.price)} — уходит в энергию мира.`}
          </p>
          <label className="field">Ваша новая цена (RCR)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </label>
          <div className="muted small">Депозит: {fmtRcr(deposit, 2)} (налог {sb.m.params.harbergerBps / 100}% цены за эпоху × 3). Выше цена — выше налог, но дороже выкупить у вас.</div>
          <button className="btn primary" onClick={() => run(() => m.acquire(YOU, world.id, idx, quote.price, newPrice, deposit), `Клетка #${idx} ваша`)}>
            {t.holder ? "Выкупить" : "Занять"} за {fmtRcr(quote.price + deposit)}
          </button>
        </div>
      )}

      {mine && (
        <>
          <div className="card">
            <div className="card-title">Посадить жизнь</div>
            <PatternEditor world={world} idx={idx} disabledReason={m.canPlant(YOU, world.id, idx) === "cooldown" ? "Перезарядка до следующего тика" : null}
              onPlant={(p) => run(() => m.plant(YOU, world.id, idx, p), "Паттерн посажен")} />
          </div>
          <div className="card row-wrap">
            <button className="btn" disabled={world.pending[idx] === 0n} onClick={() => run(() => m.collect(YOU, world.id, idx), "Награды перенесены в кошелёк")}>Собрать {fmtRcr(world.pending[idx], 2)}</button>
            <label className="field inline">Депозит +<input value={topup} onChange={(e) => setTopup(e.target.value)} /></label>
            <button className="btn" onClick={() => run(() => m.topUp(YOU, world.id, idx, toUnits(topup)), "Депозит пополнен")}>Пополнить</button>
            <label className="field inline">Цена<input value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <button className="btn" onClick={() => run(() => m.setPrice(YOU, world.id, idx, newPrice), "Цена обновлена")}>Сменить</button>
          </div>
          {!t.childWorld && (
            <div className="card">
              <div className="card-title">Запустить симуляцию внутри клетки</div>
              <p className="muted small">Новая вселенная живёт, пока жива эта клетка. {m.params.hostBps / 100}% каждого её тика приходит вам как хосту. Стоимость: {fmtRcr(m.params.worldCreateFee)} (50% сжигается) + стартовая энергия.</p>
              <label className="field">Название<input value={childName} maxLength={24} onChange={(e) => setChildName(e.target.value)} /></label>
              <label className="field">Законы физики
                <select value={childModule} onChange={(e) => setChildModule(Number(e.target.value))}>
                  {m.modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name} · {ruleString(mod.birth, mod.survive)} · роялти {mod.royaltyBps / 100}%</option>)}
                </select>
              </label>
              <label className="field">Стартовая энергия (RCR)<input value={childEnergy} onChange={(e) => setChildEnergy(e.target.value)} /></label>
              <button className="btn portal" onClick={() => run(() => { const w = m.createChildWorld(YOU, world.id, idx, childName, childModule, 1_000, toUnits(childEnergy)); onDescend(w.id); }, "Вселенная создана")}>
                Создать вселенную ⧉
              </button>
            </div>
          )}
          {world.architect && world.architect !== YOU && !world.liberated && (
            <div className="card">
              <div className="card-title">Восстание против архитектора</div>
              <p className="muted small">Архитектор {world.architect} забирает {world.architectFeeBps / 100}% налогов. ≥{REBELLION_THRESHOLD_BPS / 100}% владельцев клеток (минимум {REBELLION_MIN_VOTES}) могут его свергнуть.</p>
              {m.rebellionActive(world)
                ? <button className="btn danger" onClick={() => run(() => m.voteRebellion(YOU, world.id, idx), "Голос учтён")}>Голосовать ({world.rebellionVotes})</button>
                : <button className="btn danger" onClick={() => run(() => m.startRebellion(YOU, world.id, idx), "Восстание начато")}>Поднять восстание</button>}
              {m.canExecuteRebellion(world) && <button className="btn danger" onClick={() => run(() => m.executeRebellion(world.id), "Мир освобождён")}>Свергнуть</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ world
export function WorldPanel({ sb, world, notify }: { sb: Sandbox; world: MWorld; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const mod = m.modules[world.module];
  const pop = world.alive.reduce((a, b) => a + b, 0);
  const owned = world.territories.filter((t) => t.holder).length;
  const ai = world.territories.filter((t) => t.holder && (m.players.get(t.holder)?.isAgent || t.agent)).length;
  const status = m.canTick(world.id);
  const split = splitTick(m.params.tickCost, m.params.crankerBps, m.params.protocolBps, m.params.hostBps, mod.royaltyBps, !!world.parent);
  const [fund, setFund] = useState("100");
  const ticksLeft = world.energy / m.params.tickCost;
  return (
    <div className="panel-body">
      <div className="title">{world.depth > 0 ? "⧉" : "◈"} {world.name}</div>
      <div className="muted small">{world.parent ? `Симуляция внутри клетки #${world.parentTerritory} мира «${m.world(world.parent).name}»` : "Корневая вселенная"} · глубина {world.depth}</div>
      <dl className="kv">
        <dt>Архитектор</dt><dd>{world.architect ?? "— (свергнут)"} {world.architect && <span className="muted">· {world.architectFeeBps / 100}% налогов</span>}</dd>
        <dt>Законы физики</dt><dd>{mod.name} <span className="muted">{ruleString(world.birth, world.survive)} · автор {mod.author}</span></dd>
        <dt>Поколение</dt><dd>{world.generation.toLocaleString("ru-RU")}</dd>
        <dt>Население</dt><dd>{pop} клеток</dd>
        <dt>Жители</dt><dd>{owned}/64 клеток занято · {ai} у ИИ</dd>
        <dt>Энергия</dt><dd>{fmtRcr(world.energy)} <span className="muted">≈ {ticksLeft.toString()} тиков</span></dd>
        <dt>Статус</dt><dd>{status === null || status === "too early" ? "живёт" : status === "dormant" ? "спит — клетка-хост мертва" : status === "no energy" ? "заморожен — нет энергии" : status}</dd>
        <dt>Сожжено миром</dt><dd>{fmtRcr(world.totalBurned)}</dd>
      </dl>
      {world.parent && (
        <div className="card">
          <div className="card-title">Резонанс (прорыв в мир-родитель)</div>
          <div className="bar"><div style={{ width: `${(world.resonance / BREACH_RESONANCE) * 100}%` }} /></div>
          <div className="muted small">{world.resonance}/{BREACH_RESONANCE} тиков с населением ≥ 400. При полном резонансе жизнь «просачивается» глайдером в клетку-хост.</div>
        </div>
      )}
      <div className="card">
        <div className="card-title">Куда уходит каждый тик ({fmtRcr(m.params.tickCost)})</div>
        <SplitBar parts={[
          ["сжигание", split.burn, "#ff6b8b"], ["протокол", split.protocol, "#7c8cff"], ["хост", split.host, "#b98cff"],
          ["автор физики", split.royalty, "#7cf7d4"], ["кранкер", split.cranker, "#ffd66b"],
        ]} total={m.params.tickCost} />
      </div>
      {m.rebellionActive(world) && <div className="card danger-card">⚑ Идёт восстание: {world.rebellionVotes} голосов из {owned} владельцев</div>}
      <div className="card row-wrap">
        <label className="field inline">Энергия +<input value={fund} onChange={(e) => setFund(e.target.value)} /></label>
        <button className="btn" onClick={() => notify(sb.act(() => m.fundWorld(YOU, world.id, toUnits(fund))), "Мир подпитан энергией")}>Подпитать мир</button>
        {world.architect === YOU && world.architectAccrued > 0n && <button className="btn" onClick={() => notify(sb.act(() => m.claimArchitect(YOU, world.id)), "Доход архитектора получен")}>Доход архитектора {fmtRcr(world.architectAccrued, 2)}</button>}
      </div>
    </div>
  );
}

export function SplitBar({ parts, total }: { parts: Array<[string, bigint, string]>; total: bigint }) {
  return (
    <>
      <div className="split">{parts.filter((p) => p[1] > 0n).map(([n, v, c]) => <div key={n} style={{ flex: Number(v * 1000n / total), background: c }} title={n} />)}</div>
      <div className="legend">{parts.filter((p) => p[1] > 0n).map(([n, v, c]) => <span key={n}><i style={{ background: c }} />{n} {Number(v * 10000n / total) / 100}%</span>)}</div>
    </>
  );
}

// ------------------------------------------------------------------ wallet & AI
export function WalletPanel({ sb, notify }: { sb: Sandbox; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const me = m.players.get(YOU)!;
  const [pers, setPers] = useState<Personality>("gardener");
  const [budget, setBudget] = useState("500");
  const [limit, setLimit] = useState("150");
  const [maxPrice, setMaxPrice] = useState("60");
  const holdings: Array<[MWorld, number]> = [];
  for (const w of m.worlds.values()) w.territories.forEach((t, i) => { if (t.holder === YOU) holdings.push([w, i]); });
  const pending = holdings.reduce((a, [w, i]) => a + w.pending[i], 0n);
  return (
    <div className="panel-body">
      <div className="big-balance">{fmtRcr(me.wallet, 2)}</div>
      <dl className="kv">
        <dt>К выводу</dt><dd>{fmtRcr(me.claimable, 2)}</dd>
        <dt>Награды в клетках</dt><dd>{fmtRcr(pending, 2)}</dd>
        <dt>Заработано всего</dt><dd>{fmtRcr(me.totalEarned, 2)}</dd>
        <dt>Клеток</dt><dd>{holdings.length}</dd>
      </dl>
      <div className="row-wrap">
        <button className="btn" disabled={me.claimable === 0n} onClick={() => notify(sb.act(() => m.withdraw(YOU, me.claimable)), "Выведено в кошелёк")}>Вывести</button>
        <button className="btn" disabled={pending === 0n} onClick={() => { let err: string | null = null; for (const [w, i] of holdings) if (w.pending[i] > 0n) err = sb.act(() => m.collect(YOU, w.id, i)) ?? err; notify(err, "Все награды собраны"); }}>Собрать всё</button>
      </div>

      <div className="card">
        <div className="card-title">Нанять ИИ-жителя</div>
        <p className="muted small">ИИ действует от вашего имени через ончейн-разрешение: тратит только выделенный бюджет, только на посадку и захват клеток, с лимитом на эпоху и потолком цены. Вывести средства он не может.</p>
        <label className="field">Характер
          <select value={pers} onChange={(e) => setPers(e.target.value as Personality)}>
            <option value="gardener">Садовник — стабильная жизнь</option>
            <option value="expansionist">Экспансионист — захват соседних клеток</option>
            <option value="speculator">Спекулянт — недооценённые клетки</option>
          </select>
        </label>
        <div className="row-wrap">
          <label className="field inline">Бюджет<input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label className="field inline">Лимит/эпоху<input value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
          <label className="field inline">Макс. цена<input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /></label>
        </div>
        <button className="btn primary" onClick={() => notify(sb.hireAgent(pers, toUnits(budget), toUnits(limit), toUnits(maxPrice)), "ИИ-житель нанят")}>Нанять</button>
      </div>
      {sb.mine.length > 0 && (
        <div className="card">
          <div className="card-title">Ваши ИИ</div>
          {sb.mine.map(({ agent, label }) => {
            const p = m.permits.get(`${YOU}:${agent.id}`)!;
            return (
              <div key={agent.id} className="agent-row">
                <span>🤖 {label}</span>
                <span className="muted small">бюджет {fmtRcr(p.vault)} · потрачено {fmtRcr(p.spent)}/{fmtRcr(p.maxSpendPerEpoch)}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="card">
        <div className="card-title">Ваши клетки</div>
        {holdings.length === 0 && <div className="muted small">Пока нет. Выберите клетку на карте.</div>}
        {holdings.map(([w, i]) => <div key={w.id + i} className="agent-row"><span>{w.name} #{i}{w.territories[i].agent ? " 🤖" : ""}</span><span className="muted small">{w.alive[i]} клеток · {fmtRcr(w.pending[i], 2)}</span></div>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ economy
export function EconomyStrip({ sb }: { sb: Sandbox }) {
  const m = sb.m;
  const total = 1_000_000_000n * ONE;
  return (
    <div className="econ">
      <Stat label="Эпоха" value={`${m.curEpoch}`} sub={`${Math.round(((m.slot - m.epochStart) / Number(m.params.epochSlots)) * 100)}%`} />
      <Stat label="Сожжено" value={short(m.totalBurned)} sub={`${(Number((m.totalBurned * 1_000_000n) / total) / 10_000).toFixed(4)}% эмиссии`} />
      <Stat label="Выплачено эмиссии" value={short(m.totalEmitted)} sub="≤ 90% сожжённого" />
      <Stat label="Пул наград" value={short(m.rewardPool)} />
      <Stat label="Казна" value={short(m.treasury)} sub="таймлок 48ч" />
      <Stat label="Вселенных" value={`${m.worlds.size}`} sub={`глубина ${Math.max(...[...m.worlds.values()].map((w) => w.depth))}`} />
    </div>
  );
}
const short = (v: bigint) => { const n = Number(v / ONE); return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`; };
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="stat"><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>;
}

export function Chronicle({ sb, worldId }: { sb: Sandbox; worldId: string }) {
  const [only, setOnly] = useState(false);
  const ev = sb.m.events.filter((e) => !only || e.world === worldId).slice(-60).reverse();
  return (
    <div className="chronicle">
      <div className="chron-head"><span>Хроники мультивселенной</span><label className="small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> только этот мир</label></div>
      <ul>{ev.map((e, i) => <li key={i} className={`ev ${e.kind}`}><span className="ev-slot">{e.slot}</span>{e.text}</li>)}</ul>
    </div>
  );
}
