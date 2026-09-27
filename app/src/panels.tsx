import { useMemo, useState } from "react";
import {
  BREACH_RESONANCE, ONE, PATTERNS, SEASON_EPOCHS, TOURNAMENT_JOIN_EPOCHS, TOURNAMENT_MAX_PLAYERS, TOURNAMENT_TIERS, tournamentPlaces, QUANTUM_DELAY_SLOTS, QUANTUM_REVEAL_SLOTS, REBELLION_MIN_VOTES, REBELLION_THRESHOLD_BPS, Rng,
  cellsFromPattern, epochTax, isQuantum, patternFromCells, ruleString, scoreBlockPattern, splitTick, type MSwap, type MWorld, type Personality,
} from "@recursia/sdk";
import { fmtRcr, YOU, type Sandbox } from "./sandbox";
import { youify } from "./lib/format";
import { holderColor } from "./WorldCanvas";
import { Art, Glyph, WorldIcon, type ArtName } from "./ui/Icon";
import { SeasonCard, SponsorCard } from "./ui/Season";
import { TournamentCard } from "./ui/Tournament";
import { plantAdvice } from "./lib/advice";

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
          <WorldIcon neutral={w.neutral} depth={w.depth} /><span className="tree-name">{w.name}</span>
          {w.liberated && !w.neutral && <Art name="rebel" size={16} className="tag-free" title="Свободный мир: архитектор свергнут восстанием" />}
          {isQuantum(w) && <Art name="quantum" size={15} className="tag-ico" title="квантовые законы физики" />}
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
export function PatternEditor({ world, idx, onPlant, disabledReason, cost = "5 SKR" }: { world: MWorld; idx: number; onPlant: (p: bigint) => void; disabledReason: string | null; cost?: string }) {
  const [cells, setCells] = useState<boolean[][]>(() => cellsFromPattern(PATTERNS.acorn));
  const pattern = patternFromCells(cells);
  const forecast = useMemo(() => quantumForecast(world, idx, pattern), [world, world.generation, idx, pattern]);
  const advice = plantAdvice(forecast.lo, forecast.hi, world.alive[idx] ?? 0);
  const toggle = (r: number, c: number) => setCells((old) => old.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))));
  return (
    <div className="pattern">
      <div className="pattern-grid">
        {cells.map((row, r) => row.map((v, c) => (
          <button key={`${r}-${c}`} className={v ? "pc on" : "pc"} onClick={() => toggle(r, c)} aria-label={`клетка ${r + 1},${c + 1}`} aria-pressed={v} />
        )))}
      </div>
      <div className="pattern-side">
        <div className="presets">
          {Object.entries(PATTERNS).map(([name, p]) => (
            <button key={name} className="chip" onClick={() => setCells(cellsFromPattern(p))}>{PATTERN_NAMES[name] ?? name}</button>
          ))}
          <button className="chip" onClick={() => setCells(cellsFromPattern(0n))}>очистить</button>
        </div>
        <div className="forecast">Прогноз через 16 поколений: <b>{forecast.lo === forecast.hi ? forecast.lo : `${forecast.lo}–${forecast.hi}`}</b> живых клеток в блоке
          {forecast.lo !== forecast.hi && <div className="muted small"><Art name="quantum" size={14} /> квантовый разброс: точное будущее не вычислимо до появления энтропии слота</div>}
        </div>
        <div className={`advice ${advice.level}`} role={advice.level === "ok" ? "status" : "alert"} data-testid="plant-advice">
          <Glyph name={advice.level === "ok" ? "check" : "warn"} size={14} /> {advice.text}
        </div>
        <button className="btn primary" disabled={!!disabledReason} title={disabledReason ?? ""} onClick={() => onPlant(pattern)}>
          {advice.level === "danger" ? "Всё равно посадить" : "Посадить жизнь"} · {cost}
        </button>
        {disabledReason && <div className="muted small">{disabledReason}</div>}
      </div>
    </div>
  );
}
/** Forecast: exact for classical worlds, min–max over sampled futures for quantum ones. */
function quantumForecast(world: MWorld, idx: number, pattern: bigint): { lo: number; hi: number } {
  if (!isQuantum(world)) { const v = scoreBlockPattern(world.grid, world.birth, world.survive, idx, pattern, 16, 16); return { lo: v, hi: v }; }
  const r = new Rng(0x51ab + idx);
  const q = { qBirth: world.qBirth, qSurvive: world.qSurvive, amp: world.qAmp, seed: [0n, 0n, 0n, 0n] };
  let lo = 64, hi = 0;
  for (let k = 0; k < 8; k++) {
    const v = scoreBlockPattern(world.grid, world.birth, world.survive, idx, pattern, 16, 16, q, 0n, () => r.u32());
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return { lo, hi };
}

// ------------------------------------------------------------------ quantum
const PATTERN_OPTIONS = Object.entries(PATTERNS);

export function QuantumCard({ sb, world, idx, notify }: { sb: Sandbox; world: MWorld; idx: number; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const [a, setA] = useState("glider");
  const [b, setB] = useState("acorn");
  const [weight, setWeight] = useState(5_000);
  const [ent, setEnt] = useState("");
  const sp = m.superposition(world.id, idx);
  const key = `${world.id}:${idx}`;
  const secret = sb.secrets.get(key);
  const partners: Array<[string, number, string]> = [];
  for (const w of m.worlds.values()) if (w.id !== world.id) w.territories.forEach((t, i) => { if (t.holder === YOU) partners.push([w.id, i, `${w.name} #${i}`]); });
  const entangle = ent ? { world: ent.split("|")[0], index: Number(ent.split("|")[1]) } : undefined;
  const stake = m.quantumStake(!!entangle);
  const cost = m.params.plantCost * (entangle ? 2n : 1n);
  const why = sp ? null : m.canQuantumCommit(YOU, world.id, idx, entangle ?? null);

  if (sp) {
    const preview = secret ? m.previewCollapse(world.id, idx, secret.weight) : null;
    const left = sp.observed ? sp.revealDeadline - m.slot : sp.targetSlot - m.slot;
    return (
      <div className="card quantum-card">
        <div className="card-title"><Art name="quantum" size={20} />Клетка в суперпозиции</div>
        <dl className="kv">
          <dt>Состояние</dt><dd>{sp.observed ? "наблюдали — волновая функция зафиксирована" : left > 0 ? `ждёт энтропии слота ${sp.targetSlot} (${left} сл.)` : "готова к измерению"}</dd>
          <dt>Ставка</dt><dd>{fmtRcr(sp.stake, 2)} <span className="muted">(вернётся при коллапсе)</span></dd>
          {sp.world2 && <><dt>Запутана с</dt><dd>{m.world(sp.world2).name} #{sp.index2}</dd></>}
        </dl>
        {sp.observed && preview && secret && (
          <p className="small">
            Прогноз коллапса: ветвь <b>{preview.branchA ? "A" : "B"}</b>{preview.tunnel ? <> + <Art name="energy" size={16} /> туннелирование в соседнюю клетку</> : ""}.
            {" "}Раскрыть нужно в течение {Math.max(0, left)} слотов, иначе ставка будет потеряна.
          </p>
        )}
        {!secret && <p className="small danger-text">Секрет утерян: раскрыть невозможно, ставка уйдёт в пул наград при декогеренции.</p>}
        <button className="btn portal" disabled={!sp.observed || !secret} onClick={() => notify(sb.collapse(world.id, idx), "Волновая функция коллапсировала")}><Art name="quantum" size={18} /> Коллапс</button>
        {!sp.observed && <div className="muted small">Измерение делает любой наблюдатель (Хранитель/ИИ) за {100 / 20}% ставки.</div>}
      </div>
    );
  }
  return (
    <div className="card quantum-card">
      <div className="card-title"><Art name="quantum" size={20} />Суперпозиция</div>
      <p className="muted small">
        Посадите два паттерна сразу: |ψ⟩ = √w·|A⟩ + √(1−w)·|B⟩. Выбор скрыт хешем (commit), исход решит энтропия слота через {QUANTUM_DELAY_SLOTS} слотов —
        её не знает никто, включая вас. С шансом 1/16 паттерн туннелирует в соседнюю клетку. Запутанная пара в другом мире получит противоположную ветвь.
      </p>
      <div className="row-wrap">
        <label className="field inline">A<select value={a} onChange={(e) => setA(e.target.value)}>{PATTERN_OPTIONS.map(([n]) => <option key={n} value={n}>{PATTERN_NAMES[n] ?? n}</option>)}</select></label>
        <label className="field inline">B<select value={b} onChange={(e) => setB(e.target.value)}>{PATTERN_OPTIONS.map(([n]) => <option key={n} value={n}>{PATTERN_NAMES[n] ?? n}</option>)}</select></label>
      </div>
      <label className="field">Амплитуда A: {(weight / 100).toFixed(0)}% · B: {((10_000 - weight) / 100).toFixed(0)}%
        <input type="range" min={0} max={10_000} step={500} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
      </label>
      <label className="field">Запутать с
        <select value={ent} onChange={(e) => setEnt(e.target.value)}>
          <option value="">— без запутанности —</option>
          {partners.map(([w, i, label]) => <option key={`${w}|${i}`} value={`${w}|${i}`}>{label}</option>)}
        </select>
      </label>
      <div className="muted small">Плата {fmtRcr(cost)} ({m.params.protocolBps / 100}% — студии, остальное — в пул наград), в залог {fmtRcr(stake)} (вернётся при раскрытии; не раскроете за {QUANTUM_REVEAL_SLOTS.toLocaleString("ru-RU")} слотов — уйдёт в пул наград).</div>
      <button className="btn portal" disabled={!!why} title={why ?? ""} onClick={() => notify(sb.superpose(world.id, idx, PATTERNS[a], PATTERNS[b], weight, entangle), "Клетка в суперпозиции ψ")}>
        Суперпозиция · {fmtRcr(cost + stake)}
      </button>
      {why && <div className="muted small">{why === "cooldown" ? "Перезарядка до следующего тика" : why}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ neutral worlds: SWAP
function SwapRow({ sb, s, notify }: { sb: Sandbox; s: MSwap; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m; const w = m.world(s.world);
  const gap = w.alive[s.indexB] - w.alive[s.indexA];
  const state = s.accepted
    ? (m.slot > s.targetSlot ? "ждёт ответа ORAO VRF…" : `измерение после слота ${s.targetSlot} (${s.targetSlot - m.slot} сл.)`)
    : m.slot > s.expirySlot ? "истекло" : `открыто ещё ${s.expirySlot - m.slot} сл.`;
  return (
    <div className="swap-row">
      <div className="small"><b>#{s.indexA}</b> ({s.offerer}) <Art name="swap" size={15} className="inline-ico" /> <b>#{s.indexB}</b> ({s.acceptor}) · p={(s.weightBps / 100).toFixed(0)}% · премия {fmtRcr(s.premium, 2)}</div>
      <div className="muted tiny">{state} · разница жизни {gap > 0 ? "+" : ""}{gap} кл. в пользу #{gap >= 0 ? s.indexB : s.indexA}</div>
      <div className="row-wrap">
        {m.canSwapAccept(YOU, s.world, s.indexA, s.indexB) === null && <button className="btn portal" onClick={() => notify(sb.act(() => m.swapAccept(YOU, s.world, s.indexA, s.indexB)), "SWAP принят — исход решит энтропия")}>Принять · получить {fmtRcr(s.premium, 2)}</button>}
        {m.canSwapCancel(YOU, s.world, s.indexA, s.indexB) === null && <button className="btn" onClick={() => notify(sb.act(() => m.swapCancel(YOU, s.world, s.indexA, s.indexB)), "Предложение отменено")}>Отменить</button>}
      </div>
    </div>
  );
}

export function SwapCard({ sb, world, idx, notify }: { sb: Sandbox; world: MWorld; idx: number; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const t = world.territories[idx];
  const myBlocks = world.territories.map((x, i) => [x, i] as const).filter(([x]) => x.holder === YOU).map(([, i]) => i);
  const [from, setFrom] = useState<number>(myBlocks[0] ?? -1);
  const [weight, setWeight] = useState(3_000);
  const [premium, setPremium] = useState("140");
  const related = [...m.swaps.values()].filter((s) => s.world === world.id && (s.indexA === idx || s.indexB === idx));
  const foreign = !!t.holder && t.holder !== YOU;
  const a = myBlocks.includes(from) ? from : myBlocks[0] ?? -1;
  const prem = toUnits(premium);
  const why = a >= 0 ? m.canSwapOffer(YOU, world.id, a, idx, weight, prem) : "нужна своя клетка в этом мире";
  const gap = a >= 0 ? world.alive[idx] - world.alive[a] : 0;
  const ev = (gap * weight) / 10_000;
  return (
    <div className="card swap-card">
      <div className="card-title"><Art name="swap" size={22} />Квантовый SWAP</div>
      <p className="muted small">В нейтральном мире нет архитектора — игроки обмениваются исходами. Предложите владельцу обмен содержимым клеток с вероятностью p; он получает премию за риск при любом исходе. Исход решает хеш будущего слота, после принятия сделка обязательна для клеток.</p>
      {foreign && (
        <>
          <div className="row-wrap">
            <label className="field inline">Моя клетка
              <select value={a} onChange={(e) => setFrom(Number(e.target.value))}>
                {myBlocks.length === 0 && <option value={-1}>— нет —</option>}
                {myBlocks.map((i) => <option key={i} value={i}>#{i} · {world.alive[i]} живых</option>)}
              </select>
            </label>
            <label className="field inline">Премия<input value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" /></label>
          </div>
          <label className="field">Вероятность обмена p = {(weight / 100).toFixed(0)}%
            <input type="range" min={500} max={10_000} step={500} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
          </label>
          {a >= 0 && <div className="small">Ожидание: {ev >= 0 ? "+" : ""}{ev.toFixed(1)} живых клеток для вас (#{a}: {world.alive[a]} ⇄ #{idx}: {world.alive[idx]})</div>}
          <div className="muted small">Сбор {fmtRcr(m.swapFee(), 2)}: 80% — плата (студии и в пул наград), 20% — награда тому, кто разрешит обмен.</div>
          <button className="btn portal" disabled={!!why} title={why ?? ""} onClick={() => notify(sb.act(() => m.swapOffer(YOU, world.id, a, idx, weight, prem)), "Предложение SWAP отправлено")}>
            Предложить SWAP · {fmtRcr(m.swapFee() + prem, 2)}
          </button>
          {why && <div className="muted small">{why}</div>}
        </>
      )}
      {related.length > 0 && <div className="swap-list">{related.map((s) => <SwapRow key={s.key} sb={sb} s={s} notify={notify} />)}</div>}
      {!foreign && related.length === 0 && <div className="muted small">Выберите чужую клетку, чтобы предложить обмен.</div>}
    </div>
  );
}

export const PATTERN_NAMES: Record<string, string> = { glider: "глайдер", lwss: "корабль", rpentomino: "R-пентамино", block: "блок", acorn: "жёлудь", beacon: "маяк" };

// ------------------------------------------------------------------ territory
export function TerritoryPanel({ sb, world, idx, onDescend, notify }: { sb: Sandbox; world: MWorld; idx: number; onDescend: (id: string) => void; notify: (e: string | null, ok?: string) => void }) {
  const m = sb.m;
  const t = world.territories[idx];
  const mine = t.holder === YOU;
  const quote = m.quote(world.id, idx);
  const [price, setPrice] = useState(() => fromUnits(quote.price * 2n > m.params.minPrice ? quote.price * 2n : m.params.minPrice));
  const [childName, setChildName] = useState("Моя симуляция");
  const [childModule, setChildModule] = useState(0);
  const [childEnergy, setChildEnergy] = useState("28000");
  const [topup, setTopup] = useState("1400");
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
        <dt>Владелец</dt><dd>{t.holder ? <>{t.holder}{t.agent && <Art name="agent" size={17} className="inline-ico" title="управляет ИИ-агент" />}</> : "свободна"}</dd>
        <dt>Живых клеток</dt><dd>{world.alive[idx]} / 64</dd>
        <dt>Очки эпохи</dt><dd>{world.scoresCur[idx].toLocaleString("ru-RU")}</dd>
        {t.holder && <><dt>Цена (самооценка)</dt><dd>{fmtRcr(t.price)}</dd></>}
        {t.holder && <><dt>Депозит налога</dt><dd>{fmtRcr(t.deposit, 2)} <span className="muted">({fmtRcr(taxPerEpoch, 2)}/эпоху)</span></dd></>}
        <dt>Награды к сбору</dt><dd>{fmtRcr(world.pending[idx], 2)}</dd>
        {t.childWorld && <><dt>Внутри</dt><dd><Art name="nested" size={16} /> {m.world(t.childWorld).name}</dd></>}
        {m.superposition(world.id, idx) && <><dt>Квантовое</dt><dd>ψ в суперпозиции ({m.superposition(world.id, idx)!.owner})</dd></>}
      </dl>

      {t.childWorld && <button className="btn portal" onClick={() => onDescend(t.childWorld!)}><Art name="nested" size={20} /> Войти в симуляцию <Glyph name="arrow" size={14} /></button>}

      {!mine && (
        <div className="card">
          <div className="card-title"><Glyph name="tag" size={17} className="gold" />{t.holder ? "Выкупить по налогу Харбергера" : "Занять клетку"}</div>
          <p className="muted small">
            {t.holder
              ? `Владелец обязан продать по своей цене. Вы платите ${fmtRcr(quote.price)} — цена зафиксирована как лимит (защита от фронтраннинга).`
              : `Свободная клетка стоит ${fmtRcr(quote.price)} — уходит в энергию мира.`}
          </p>
          <label className="field">Ваша новая цена (SKR)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </label>
          <div className="muted small">Депозит: {fmtRcr(deposit, 2)} (налог {sb.m.params.harbergerBps / 100}% цены за эпоху × 3). Выше цена — выше налог, но дороже выкупить у вас.</div>
          <button className="btn primary" onClick={() => run(() => m.acquire(YOU, world.id, idx, quote.price, newPrice, deposit), `Клетка #${idx} ваша`)}>
            {t.holder ? "Выкупить" : "Занять"} за {fmtRcr(quote.price + deposit)}
          </button>
        </div>
      )}

      {!mine && world.neutral && t.holder && <SwapCard sb={sb} world={world} idx={idx} notify={notify} />}

      {mine && (
        <>
          <div className="card">
            <div className="card-title"><Art name="plant" size={22} />Посадить жизнь</div>
            <PatternEditor world={world} idx={idx} disabledReason={m.canPlant(YOU, world.id, idx) === "cooldown" ? "Перезарядка до следующего тика" : null}
              onPlant={(p) => run(() => m.plant(YOU, world.id, idx, p), "Паттерн посажен")} />
          </div>
          <QuantumCard sb={sb} world={world} idx={idx} notify={notify} />
          {world.neutral && <SwapCard sb={sb} world={world} idx={idx} notify={notify} />}
          <div className="card row-wrap">
            <button className="btn" disabled={world.pending[idx] === 0n} onClick={() => run(() => m.collect(YOU, world.id, idx), "Награды перенесены в кошелёк")}>Собрать {fmtRcr(world.pending[idx], 2)}</button>
            <label className="field inline">Депозит +<input value={topup} onChange={(e) => setTopup(e.target.value)} /></label>
            <button className="btn" onClick={() => run(() => m.topUp(YOU, world.id, idx, toUnits(topup)), "Депозит пополнен")}>Пополнить</button>
            <label className="field inline">Цена<input value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <button className="btn" onClick={() => run(() => m.setPrice(YOU, world.id, idx, newPrice), "Цена обновлена")}>Сменить</button>
          </div>
          {!t.childWorld && (
            <div className="card">
              <div className="card-title"><Art name="nested" size={20} />Запустить симуляцию внутри клетки</div>
              <p className="muted small">Новая вселенная живёт, пока жива эта клетка. {m.params.hostBps / 100}% каждого её тика приходит вам как хосту. Стоимость: {fmtRcr(m.params.worldCreateFee)} ({m.params.protocolBps / 100}% — студии, остальное — в пул наград) + стартовая энергия.</p>
              <label className="field">Название<input value={childName} maxLength={24} onChange={(e) => setChildName(e.target.value)} /></label>
              <label className="field">Законы физики
                <select value={childModule} onChange={(e) => setChildModule(Number(e.target.value))}>
                  {m.modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name} · {ruleString(mod.birth, mod.survive, mod.qBirth, mod.qSurvive, mod.qAmp)} · роялти {mod.royaltyBps / 100}%</option>)}
                </select>
              </label>
              <label className="field">Стартовая энергия (SKR)<input value={childEnergy} onChange={(e) => setChildEnergy(e.target.value)} /></label>
              <button className="btn portal" onClick={() => run(() => { const w = m.createChildWorld(YOU, world.id, idx, childName, childModule, 1_000, toUnits(childEnergy)); onDescend(w.id); }, "Вселенная создана")}>
                <Art name="nested" size={20} /> Создать вселенную
              </button>
            </div>
          )}
          {world.architect && world.architect !== YOU && !world.liberated && (
            <div className="card">
              <div className="card-title"><Art name="rebel" size={22} />Восстание против архитектора</div>
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
  const [fund, setFund] = useState("7000");
  const ticksLeft = world.energy / m.params.tickCost;
  return (
    <div className="panel-body">
      <div className="title"><WorldIcon neutral={world.neutral} depth={world.depth} size={26} />{world.name}</div>
      <div className="muted small">{world.parent ? `Симуляция внутри клетки #${world.parentTerritory} мира «${m.world(world.parent).name}»` : "Корневая вселенная"} · глубина {world.depth}</div>
      <dl className="kv">
        <dt>Архитектор</dt><dd>{world.architect ?? (world.neutral ? "— нейтральный мир" : "— (свергнут)")} {world.architect && <span className="muted">· {world.architectFeeBps / 100}% налогов</span>}</dd>
        <dt>Законы физики</dt><dd>{mod.name} <span className="muted">{ruleString(world.birth, world.survive, world.qBirth, world.qSurvive, world.qAmp)} · автор {mod.author}</span></dd>
        {isQuantum(world) && <><dt><Art name="quantum" size={14} /> Квантовый мир</dt><dd>будущее не вычислимо заранее · энтропия {world.entropy ? Array.from(world.entropy.slice(0, 4), (x) => x.toString(16).padStart(2, "0")).join("") + "…" : "—"} · в суперпозиции {world.superpositions}</dd></>}
        <dt>Поколение</dt><dd>{world.generation.toLocaleString("ru-RU")}</dd>
        <dt>Население</dt><dd>{pop} клеток</dd>
        <dt>Жители</dt><dd>{owned}/64 клеток занято · {ai} у ИИ</dd>
        <dt>Энергия</dt><dd>{fmtRcr(world.energy)} <span className="muted">≈ {ticksLeft.toString()} тиков</span></dd>
        <dt>Статус</dt><dd>{status === null || status === "too early" ? "живёт" : status === "dormant" ? "спит — клетка-хост мертва" : status === "no energy" ? "заморожен — нет энергии" : status}</dd>
        <dt>Вклад мира в пул наград</dt><dd>{fmtRcr(world.totalSunk)}</dd>
      </dl>
      {world.parent && (
        <div className="card">
          <div className="card-title"><Art name="breach" size={22} />Резонанс (прорыв в мир-родитель)</div>
          <div className="bar"><div style={{ width: `${(world.resonance / BREACH_RESONANCE) * 100}%` }} /></div>
          <div className="muted small">{world.resonance}/{BREACH_RESONANCE} тиков с населением ≥ 400. При полном резонансе жизнь «просачивается» глайдером в клетку-хост.</div>
        </div>
      )}
      <div className="card">
        <div className="card-title"><Glyph name="flow" size={17} />Куда уходит каждый тик ({fmtRcr(m.params.tickCost)})</div>
        <SplitBar parts={[
          ["пул наград", split.pool, "#ff6b8b"], ["студия", split.protocol, "#7c8cff"], ["хост", split.host, "#b98cff"],
          ["автор физики", split.royalty, "#7cf7d4"], ["кранкер", split.cranker, "#ffd66b"],
        ]} total={m.params.tickCost} />
      </div>
      {world.neutral && (
        <div className="card swap-card">
          <div className="card-title"><Art name="neutral" size={20} />Нейтральный мир · рынок SWAP</div>
          <p className="muted small">Никто не правит этим миром: нет архитектора и его налога, восстание невозможно. Здесь разрешены только квантовые законы, а игроки торгуют исходами — вероятностными обменами клеток.</p>
          {[...m.swaps.values()].filter((s) => s.world === world.id).length === 0
            ? <div className="muted small">Открытых сделок нет. Выберите чужую клетку, чтобы предложить обмен.</div>
            : <div className="swap-list">{[...m.swaps.values()].filter((s) => s.world === world.id).map((s) => <SwapRow key={s.key} sb={sb} s={s} notify={notify} />)}</div>}
        </div>
      )}
      {m.rebellionActive(world) && <div className="card danger-card"><Art name="rebel" size={20} /> Идёт восстание: {world.rebellionVotes} голосов из {owned} владельцев</div>}
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
  const [budget, setBudget] = useState("35000");
  const [limit, setLimit] = useState("10500");
  const [maxPrice, setMaxPrice] = useState("4200");
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
        <div className="card-title"><Art name="agent" size={22} />Нанять ИИ-жителя</div>
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
          <div className="card-title"><Art name="agent" size={22} />Ваши ИИ</div>
          {sb.mine.map(({ agent, label }) => {
            const p = m.permits.get(`${YOU}:${agent.id}`)!;
            return (
              <div key={agent.id} className="agent-row">
                <span><Art name="agent" size={19} /> {label}</span>
                <span className="muted small">бюджет {fmtRcr(p.vault)} · потрачено {fmtRcr(p.spent)}/{fmtRcr(p.maxSpendPerEpoch)}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="card">
        <div className="card-title"><Art name="cell" size={20} />Ваши клетки</div>
        {holdings.length === 0 && <div className="muted small">Пока нет. Выберите клетку на карте.</div>}
        {holdings.map(([w, i]) => <div key={w.id + i} className="agent-row"><span>{w.name} #{i}{w.territories[i].agent && <Art name="agent" size={16} className="inline-ico" title="ИИ-агент" />}</span><span className="muted small">{w.alive[i]} клеток · {fmtRcr(w.pending[i], 2)}</span></div>)}
      </div>
      <SeasonCard
        seasonId={m.seasonId} epochsLeft={m.seasonStartEpoch + SEASON_EPOCHS - m.curEpoch - 1} pool={m.seasonPool}
        top={m.seasonTop.filter((e) => e.player).map((e) => ({ label: e.player, points: e.points, you: e.player === YOU }))}
        myPoints={m.seasonPointsOf(YOU)}
        submitBlocked={m.seasonPointsOf(YOU) === 0n ? "Сначала соберите награды с клеток — это и есть очки" : null}
        onSubmit={() => notify(sb.act(() => { if (!m.seasonSubmit(YOU)) throw new Error("Очков пока мало для топ-10"); }), "Очки в таблице сезона")}
        last={m.lastSeason && { id: m.lastSeason.id, rows: m.lastSeason.top.map((e, r) => ({ label: e.player, points: e.points, you: e.player === YOU, prize: m.lastSeason!.prizes[r], claimed: m.lastSeason!.claimed[r] })) }}
        onClaim={(r) => notify(sb.act(() => m.claimSeasonPrize(r)), "Приз зачислен победителю")} claimBlocked={null}
        fmt={(v) => fmtRcr(v, 0)}
      />
      <TournamentCard
        seasonId={m.seasonId} joinOpen={m.curEpoch < m.seasonStartEpoch + TOURNAMENT_JOIN_EPOCHS}
        tiers={TOURNAMENT_TIERS.map((mult, tier) => {
          const t = m.tournament(m.seasonId, tier);
          const joined = !!t?.players.includes(YOU);
          const why = m.canJoinTournament(YOU, tier);
          return {
            tier, fee: t ? t.entryFee : m.params.plantCost * mult, players: t?.players.length ?? 0, max: TOURNAMENT_MAX_PLAYERS, pot: t?.pot ?? 0n, joined,
            paidPlaces: tournamentPlaces(t?.players.length ?? 0),
            top: (t?.top ?? []).filter((e) => e.player).map((e) => ({ label: e.player, points: e.points, you: e.player === YOU })),
            joinBlocked: why === null ? null : why === "registration closed" ? "Регистрация закрыта до следующего сезона" : why === "tournament full" ? "Турнир заполнен" : why === "insufficient balance" ? "Недостаточно SKR" : why,
            submitBlocked: m.seasonPointsOf(YOU) === 0n ? "Соберите награды с клеток — это и есть очки" : null,
          };
        })}
        finished={[...m.tournaments.values()].filter((t) => t.seasonId < m.seasonId && t.players.includes(YOU)).slice(-2).map((t) => ({
          seasonId: t.seasonId, tier: t.tier, settled: t.settled, pot: t.pot,
          rows: t.top.map((e, r) => ({ label: e.player || "—", points: e.points, you: e.player === YOU, prize: t.prizes[r] ?? 0n, claimed: !!t.claimed[r] })),
        }))}
        onJoin={(tier) => notify(sb.act(() => m.joinTournament(YOU, tier)), "Вы в турнире! Очки сезона считаются автоматически")}
        onSubmit={(tier) => notify(sb.act(() => { if (!m.tournamentSubmit(YOU, tier)) throw new Error("Очков пока мало для таблицы турнира"); }), "Очки обновлены")}
        onSettle={(s, tier) => notify(sb.act(() => m.settleTournament(s, tier)), "Итоги подведены")}
        onClaim={(s, tier, r) => notify(sb.act(() => m.claimTournamentPrize(s, tier, r)), "Приз зачислен победителю")}
        actionBlocked={null} fmt={(v) => fmtRcr(v, 0)}
      />
      <SponsorCard pool={m.sponsorPool} fmt={(v) => fmtRcr(v, 0)} parse={(s) => { const v = toUnits(s); return v > 0n ? v : null; }}
        blockedWhy={(a) => (a === null ? "Введите сумму" : a > me.wallet ? "Недостаточно SKR" : null)}
        onFund={(a) => notify(sb.act(() => m.fundSponsorPool(YOU, a)), "Спасибо! Живые миры получат больше")} />
    </div>
  );
}

// ------------------------------------------------------------------ economy
export function EconomyStrip({ sb }: { sb: Sandbox }) {
  const m = sb.m;
  return (
    <div className="econ">
      <Stat icon={<Glyph name="clock" size={18} className="gold" />} label="Эпоха" value={`${m.curEpoch}`} sub={`${Math.round(((m.slot - m.epochStart) / Number(m.params.epochSlots)) * 100)}%`} />
      <Stat icon={<Glyph name="flow" size={18} className="rose" />} label="В пул наград" value={short(m.totalSunk)} sub={`${100 - m.params.protocolBps / 100}% трат игроков`} />
      <Stat icon={<Art name="coin" size={22} />} label="Выплачено игрокам" value={short(m.totalEmitted)} sub={`${m.params.emissionRateBps / 100}% пула за эпоху`} />
      <Stat icon={<Art name="energy" size={22} />} label="Пул наград" value={short(m.rewardPool)} />
      <Stat icon={<Glyph name="vault" size={18} className="violet" />} label="Студия" value={short(m.treasury)} sub={`${m.params.protocolBps / 100}% трат`} />
      <Stat icon={<Glyph name="crown" size={18} className="gold" />} label={`Сезон ${m.seasonId}`} value={short(m.seasonPool)} sub="призовой фонд" />
      <Stat icon={<Glyph name="sprout" size={18} className="mint" />} label="Спонсоры" value={short(m.sponsorPool)} sub="за живые клетки" />
      <Stat icon={<Art name="nested" size={22} />} label="Вселенных" value={`${m.worlds.size}`} sub={`глубина ${Math.max(...[...m.worlds.values()].map((w) => w.depth))}`} />
    </div>
  );
}
const short = (v: bigint) => { const n = Number(v / ONE); return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`; };
function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return <div className="stat">{icon && <span className="stat-ico">{icon}</span>}<div><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div></div>;
}

/** Chronicle: a painted icon per event kind (model + sandbox kinds). */
const EVENT_ART: Record<string, ArtName> = {
  swap: "swap", quantum: "quantum", world: "nested", foreclose: "cell", acquire: "cell", rebellion: "rebel", liberated: "rebel",
  module: "law", epoch: "coin", season: "coin", sponsor: "plant", breach: "breach", agent: "agent", welcome: "logo", plant: "plant", energy: "energy",
};
const eventArt = (kind: string, text: string): ArtName =>
  kind === "quantum" && /наблюд/i.test(text) ? "observe" : kind === "quantum" && /посадил|посадка/i.test(text) ? "plant" : EVENT_ART[kind] ?? "world";
// legacy text markers ("⚛ Коллапс…") are redundant next to the icon
const stripMarker = (t: string) => t.replace(/^[^\p{L}\p{N}«"(#]+/u, "");

export function Chronicle({ sb, worldId }: { sb: Sandbox; worldId: string }) {
  const [only, setOnly] = useState(false);
  const ev = sb.m.events.filter((e) => !only || e.world === worldId).slice(-60).reverse();
  return (
    <section className="chronicle" aria-label="Хроники">
      <div className="chron-head"><span>Хроники мультивселенной</span><label className="small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> только этот мир</label></div>
      <ul aria-live="off">{ev.map((e, i) => <li key={i} className={`ev ${e.kind}`}><span className="ev-slot">{e.slot}</span><Art name={eventArt(e.kind, e.text)} size={18} className="ev-ico" /><span className="ev-text">{youify(stripMarker(e.text), YOU)}</span></li>)}</ul>
    </section>
  );
}
