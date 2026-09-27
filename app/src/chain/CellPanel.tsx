import { useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  PATTERNS, QUANTUM_DELAY_SLOTS, QUANTUM_REVEAL_SLOTS, REBELLION_MIN_VOTES, collapse, commitment, epochTax, randomSalt,
  type SuperpositionAccount,
} from "@recursia/sdk";
import { PatternEditor, PATTERN_NAMES } from "../panels";
import { rcr, shortAddr, slotsToHuman, toInput } from "../lib/format";
import { exportSecret, importSecret, loadSecret, removeSecret, saveSecret } from "../lib/secrets";
import { AmountField, Address, amountOf, Skeleton } from "../ui/fields";
import { useToast } from "../ui/Toast";
import { blocked, type ChainCtx } from "./ctx";
import { CreateWorldButton } from "./CreateWorld";

export function CellPanel({ c, idx }: { c: ChainCtx; idx: number }) {
  const { cur, model, detail, me, config } = c;
  if (!cur || !model) return null;
  if (detail.loading) return <div className="panel-body"><div className="title">Клетка #{idx}</div><Skeleton lines={5} /></div>;
  const p = config.params;
  const t = model.territories[idx];
  const acc = detail.territories.get(idx);
  const mine = !!me && t.holder === me.toBase58();
  const sp = detail.superpositions.get(idx) ?? null;
  const tax = t.holder ? epochTax(t.price, p.harbergerBps) : 0n;
  return (
    <div className="panel-body">
      <div className="kv-head">
        <div className="title">Клетка #{idx}</div>
        {mine && <span className="tag mine">ваша</span>}
        {t.agent && <span className="tag">🤖 агент</span>}
      </div>
      <dl className="kv">
        <dt>Владелец</dt><dd>{t.holder ? <Address value={t.holder} /> : "свободна"}</dd>
        <dt>Живых клеток</dt><dd>{model.alive[idx]} / 64</dd>
        <dt>Цена</dt><dd>{rcr(t.holder ? t.price : p.minPrice)}</dd>
        {t.holder && <><dt>Депозит налога</dt><dd>{rcr(t.deposit)} <span className="muted">({tax > 0n ? `${(Number(t.deposit) / Number(tax)).toFixed(1)} эп.` : "—"})</span></dd></>}
        {t.holder && <><dt>Налог / эпоху</dt><dd>{rcr(tax)}</dd></>}
        <dt>Награды</dt><dd>{rcr(model.pending[idx], 4)}</dd>
      </dl>
      {t.childWorld && <button className="btn portal" onClick={() => c.openWorld(t.childWorld!)}>⧉ Войти во вложенную вселенную</button>}

      {!mine && <AcquireCard c={c} idx={idx} />}
      {mine && <HolderCards c={c} idx={idx} />}
      {mine && !t.childWorld && acc && <CreateWorldButton c={c} kind="child" hostIndex={idx} />}
      {sp && <SuperpositionCard c={c} idx={idx} sp={sp} />}
      {mine && !sp && <SuperposeCard c={c} idx={idx} />}
      {cur.acc.neutral && <SwapCard c={c} idx={idx} />}
      {mine && cur.acc.architect && !cur.acc.architect.equals(PublicKey.default) && !cur.acc.liberated && <RebellionCard c={c} idx={idx} />}
    </div>
  );
}

function AcquireCard({ c, idx }: { c: ChainCtx; idx: number }) {
  const p = c.config.params;
  const t = c.model!.territories[idx];
  const price = t.holder ? t.price : p.minPrice;
  const [newPrice, setNewPrice] = useState(() => toInput(price * 3n / 2n > p.minPrice ? price * 3n / 2n : p.minPrice));
  const np = amountOf(newPrice, { min: p.minPrice });
  const [deposit, setDeposit] = useState(() => toInput(epochTax(price * 3n / 2n > p.minPrice ? price * 3n / 2n : p.minPrice, p.harbergerBps) * 3n));
  const dep = amountOf(deposit, { allowZero: true });
  const total = np !== null && dep !== null ? price + dep : null;
  const why = blocked(c, { spend: total ?? 0n }) ?? (np === null || dep === null ? "Проверьте поля" : null);
  return (
    <div className="card">
      <div className="card-title">{t.holder ? "Выкупить по налогу Харбергера" : "Занять свободную клетку"}</div>
      <p className="muted small">Вы платите текущую цену {t.holder ? "владельцу" : "в мир"}, затем сами назначаете новую — с неё платится налог {p.harbergerBps / 100}% за эпоху. Лимит цены = текущая цена: если кто-то перебьёт её до вас, транзакция не пройдёт.</p>
      <AmountField label="Ваша новая цена" value={newPrice} onChange={setNewPrice} min={p.minPrice} hint={np !== null ? `налог ${rcr(epochTax(np, p.harbergerBps), 4)} / эпоху` : undefined} />
      <AmountField label="Депозит налога" value={deposit} onChange={setDeposit} allowZero hint={np !== null && dep !== null && epochTax(np, p.harbergerBps) > 0n ? `хватит на ${(Number(dep) / Number(epochTax(np, p.harbergerBps))).toFixed(1)} эпох` : undefined} />
      <div className="small">Итого спишется: <b>{total !== null ? rcr(total) : "—"}</b></div>
      <button className="btn primary" disabled={!!why} title={why ?? ""} onClick={() => c.run({
        title: t.holder ? "Выкуп клетки" : "Захват клетки",
        lines: [`Мир «${c.cur!.acc.name}», клетка #${idx}`, `Цена: ${rcr(price)} (жёсткий лимит — защита от фронтраннинга)`, `Новая цена: ${rcr(np!)}`, `Депозит налога: ${rcr(dep!)}`, `Итого: ${rcr(total!)}`],
        ixs: c.withAta([c.rx.acquire(c.me!, c.cur!.key, idx, t.holder ? new PublicKey(t.holder) : null, price, np!, dep!)]),
        successText: `Клетка #${idx} ваша`,
      })}>{t.holder ? `Выкупить за ${rcr(price)}` : `Занять за ${rcr(price)}`}</button>
      {why && <div className="field-hint">{why}</div>}
    </div>
  );
}

function HolderCards({ c, idx }: { c: ChainCtx; idx: number }) {
  const p = c.config.params;
  const t = c.model!.territories[idx];
  const [price, setPrice] = useState(() => toInput(t.price));
  const [amt, setAmt] = useState("10");
  const np = amountOf(price, { min: p.minPrice });
  const a = amountOf(amt);
  const cooldown = Number(t.lastPriceChange) + 150 - c.slot;
  const plantBlocked = blocked(c, { spend: p.plantCost }) ?? (c.model!.tickCount < t.nextPlantTick ? "Перезарядка посадки до следующего тика мира" : null);
  const k = c.cur!.key;
  return (
    <>
      <div className="card">
        <div className="card-title">Посадить жизнь</div>
        <PatternEditor world={c.model!} idx={idx} cost={rcr(p.plantCost, 0)} disabledReason={plantBlocked}
          onPlant={(pat) => c.run({ title: "Посадка паттерна", lines: [`Клетка #${idx}`, `Сжигается ${rcr(p.plantCost)}`, "Паттерн заменит содержимое вашего блока 8×8"], ixs: [c.rx.plant(c.me!, k, idx, pat)], successText: "Жизнь посажена" })} />
      </div>
      <div className="card">
        <div className="card-title">Награды и депозит</div>
        <button className="btn" disabled={c.model!.pending[idx] === 0n || !!blocked(c, { paused: false })} onClick={() => c.run({
          title: "Сбор наград", lines: [`${rcr(c.model!.pending[idx], 4)} → ваш баланс к выводу`, "Сначала списывается налог с депозита"], ixs: c.withAta([c.rx.collect(c.me!, k, idx)]),
        })}>Собрать {rcr(c.model!.pending[idx], 2)}</button>
        <AmountField label="Сумма" value={amt} onChange={setAmt} />
        <div className="row-wrap">
          <button className="btn" disabled={a === null || !!blocked(c, { spend: a ?? 0n })} onClick={() => c.run({ title: "Пополнение депозита", lines: [`+${rcr(a!)} к депозиту клетки #${idx}`], ixs: [c.rx.topUp(c.me!, k, idx, a!)] })}>Пополнить</button>
          <button className="btn" disabled={a === null || a > t.deposit || !!blocked(c, { paused: false })} onClick={() => c.run({ title: "Вывод депозита", lines: [`−${rcr(a!)} из депозита клетки #${idx}`, "Если депозит кончится — клетку изымут за долги"], ixs: c.withAta([c.rx.withdrawDeposit(c.me!, k, idx, a!)]) })}>Вывести</button>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Цена клетки</div>
        <AmountField label="Новая цена" value={price} onChange={setPrice} min={p.minPrice} hint={np !== null ? `налог ${rcr(epochTax(np, p.harbergerBps), 4)} / эпоху. Высокая цена — дорогой налог, низкая — вас выкупят` : undefined} />
        <button className="btn" disabled={np === null || np === t.price || cooldown > 0 || !!blocked(c)} onClick={() => c.run({ title: "Смена цены", lines: [`${rcr(t.price)} → ${rcr(np!)}`, `Налог: ${rcr(epochTax(np!, p.harbergerBps), 4)} / эпоху`], ixs: [c.rx.setPrice(c.me!, k, idx, np!)] })}>Установить</button>
        {cooldown > 0 && <div className="field-hint">Кулдаун смены цены: {slotsToHuman(cooldown)}</div>}
      </div>
    </>
  );
}

const PATTERN_OPTIONS = Object.keys(PATTERNS);

function SuperposeCard({ c, idx }: { c: ChainCtx; idx: number }) {
  const p = c.config.params;
  const [a, setA] = useState("glider");
  const [b, setB] = useState("acorn");
  const [w, setW] = useState(5_000);
  const [ent, setEnt] = useState("");
  const partners = c.my.holdings.filter((h) => !h.acc.world.equals(c.cur!.key));
  const entangle = ent ? { world: new PublicKey(ent.split("|")[0]), index: Number(ent.split("|")[1]) } : null;
  const burn = p.plantCost * (entangle ? 2n : 1n);
  const stake = p.plantCost * 4n * (entangle ? 2n : 1n);
  const why = blocked(c, { spend: burn + stake });
  const worldName = (k: PublicKey) => c.data.worlds.find((x) => x.key.equals(k))?.acc.name ?? shortAddr(k.toBase58());
  return (
    <div className="card quantum-card">
      <div className="card-title">⚛ Суперпозиция</div>
      <p className="muted small">|ψ⟩ = √w·|A⟩ + √(1−w)·|B⟩. Выбор скрыт хешем, исход решит энтропия слота через {QUANTUM_DELAY_SLOTS} слотов. Секрет хранится только в этом браузере — скачайте его после подписи.</p>
      <div className="row-wrap">
        <label className="field inline">A<select value={a} onChange={(e) => setA(e.target.value)}>{PATTERN_OPTIONS.map((n) => <option key={n} value={n}>{PATTERN_NAMES[n] ?? n}</option>)}</select></label>
        <label className="field inline">B<select value={b} onChange={(e) => setB(e.target.value)}>{PATTERN_OPTIONS.map((n) => <option key={n} value={n}>{PATTERN_NAMES[n] ?? n}</option>)}</select></label>
      </div>
      <label className="field">Амплитуда A: {w / 100}% · B: {(10_000 - w) / 100}%
        <input type="range" min={0} max={10_000} step={500} value={w} onChange={(e) => setW(Number(e.target.value))} aria-valuetext={`${w / 100} процентов`} />
      </label>
      {partners.length > 0 && (
        <label className="field">Запутать с
          <select value={ent} onChange={(e) => setEnt(e.target.value)}>
            <option value="">— без запутанности —</option>
            {partners.map((h) => <option key={h.key.toBase58()} value={`${h.acc.world.toBase58()}|${h.acc.index}`}>{worldName(h.acc.world)} #{h.acc.index}</option>)}
          </select>
        </label>
      )}
      <div className="muted small">Сжигается {rcr(burn)}, залог {rcr(stake)} вернётся при раскрытии в течение {slotsToHuman(QUANTUM_REVEAL_SLOTS)}.</div>
      <button className="btn portal" disabled={!!why} title={why ?? ""} onClick={() => {
        const me = c.me!, k = c.cur!.key, salt = randomSalt(), A = PATTERNS[a], B = PATTERNS[b];
        saveSecret(k.toBase58(), idx, me.toBase58(), { a: A, b: B, w, salt }); // BEFORE signing
        const cm = commitment(A, B, w, salt, me.toBytes(), k.toBytes(), idx);
        c.run({
          title: "Квантовая суперпозиция",
          lines: [`Клетка #${idx}: ${w / 100}% ${PATTERN_NAMES[a] ?? a} + ${(10_000 - w) / 100}% ${PATTERN_NAMES[b] ?? b}`, `Сжигается ${rcr(burn)}, залог ${rcr(stake)}`, ...(entangle ? [`Запутанность: ${worldName(entangle.world)} #${entangle.index} получит противоположную ветвь`] : [])],
          danger: "Секрет сохранён только в этом браузере. Потеряете его — залог сгорит. Скачайте файл секрета после подтверждения.",
          ixs: [c.rx.quantumCommit(me, k, idx, cm, entangle)], successText: "Клетка в суперпозиции ψ — скачайте секрет",
        });
      }}>Суперпозиция · {rcr(burn + stake)}</button>
      {why && <div className="field-hint">{why}</div>}
    </div>
  );
}

function SuperpositionCard({ c, idx, sp }: { c: ChainCtx; idx: number; sp: SuperpositionAccount }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const me = c.me, k = c.cur!.key;
  const isOwner = !!me && sp.owner.equals(me);
  const secret = isOwner ? loadSecret(k.toBase58(), idx, me!.toBase58()) : null;
  const pv = sp.observed && secret ? collapse(sp.entropy, sp.commitment, secret.w) : null;
  const slot = BigInt(c.slot);
  const measurable = !sp.observed && slot > sp.targetSlot;
  const decoherable = sp.observed ? slot > sp.revealDeadline : slot > sp.targetSlot + BigInt(QUANTUM_REVEAL_SLOTS);
  const ent = sp.world2.equals(PublicKey.default) ? null : { world: sp.world2, index: sp.index2 };
  return (
    <div className="card quantum-card">
      <div className="card-title">ψ Суперпозиция {isOwner ? "(ваша)" : `(${shortAddr(sp.owner.toBase58())})`}</div>
      <dl className="kv">
        <dt>Состояние</dt><dd>{sp.observed ? `наблюдали, раскрыть до слота ${sp.revealDeadline}` : measurable ? "готова к наблюдению" : `ждёт слота ${sp.targetSlot}`}</dd>
        <dt>Залог</dt><dd>{rcr(sp.stake)}</dd>
        {sp.observed && !decoherable && <><dt>Осталось</dt><dd>{slotsToHuman(sp.revealDeadline - slot)}</dd></>}
      </dl>
      {pv && <div className="small">Исход: ветвь <b>{pv.branchA ? "A" : "B"}</b>{pv.tunnel ? " + ⚡ туннелирование" : ""}</div>}
      <div className="row-wrap">
        {measurable && <button className="btn" disabled={!!blocked(c, { paused: false })} onClick={() => c.run({ title: "Наблюдение", lines: ["Фиксирует энтропию слота для суперпозиции", `Награда наблюдателя: ${rcr(sp.stake / 20n)}`], ixs: c.withAta([c.rx.quantumObserve(me!, k, idx)]) })}>👁 Наблюдать · +{rcr(sp.stake / 20n)}</button>}
        {isOwner && secret && sp.observed && !decoherable && <button className="btn portal" onClick={async () => {
          const r = await c.run({ title: "Коллапс волновой функции", lines: [`Раскрытие коммита клетки #${idx}`, `Возврат залога ${rcr(sp.stake)}`], ixs: c.withAta([c.rx.quantumCollapse(me!, k, idx, secret.a, secret.b, secret.w, secret.salt, ent)]), successText: "Волновая функция коллапсировала" });
          if (r.ok) removeSecret(k.toBase58(), idx, me!.toBase58());
        }}>⚛ Коллапс</button>}
        {decoherable && me && <button className="btn" onClick={() => c.run({ title: "Декогеренция", lines: ["Окно раскрытия истекло", `Награда: ${rcr(sp.stake / 20n)}, остаток залога сжигается`], ixs: c.withAta([c.rx.quantumDecohere(me, k, idx, sp.owner)]) })}>Декогеренция · +{rcr(sp.stake / 20n)}</button>}
      </div>
      {isOwner && (
        <div className="row-wrap">
          {secret && <button className="btn" onClick={() => exportSecret(k.toBase58(), idx, me!.toBase58())}>⬇ Скачать секрет</button>}
          {!secret && <>
            <span className="small danger-text">Секрета нет в этом браузере — импортируйте файл, иначе залог сгорит.</span>
            <button className="btn" onClick={() => file.current?.click()}>⬆ Импорт секрета</button>
            <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const err = importSecret(await f.text(), k.toBase58(), idx, me!.toBase58());
              toast.push(err ? { kind: "bad", title: `Импорт: ${err}` } : { kind: "ok", title: "Секрет импортирован" });
              force((x) => x + 1);
            }} />
          </>}
        </div>
      )}
    </div>
  );
}

function SwapCard({ c, idx }: { c: ChainCtx; idx: number }) {
  const p = c.config.params;
  const me = c.me, k = c.cur!.key, model = c.model!;
  const t = model.territories[idx];
  const myBlocks = me ? model.territories.map((x, i) => [x, i] as const).filter(([x]) => x.holder === me.toBase58()).map(([, i]) => i) : [];
  const [from, setFrom] = useState(-1);
  const [weight, setWeight] = useState(3_000);
  const [premium, setPremium] = useState("0");
  const prem = amountOf(premium, { allowZero: true });
  const a = myBlocks.includes(from) ? from : myBlocks[0] ?? -1;
  const related = c.data.swaps.filter((s) => s.acc.world.equals(k) && (s.acc.indexA === idx || s.acc.indexB === idx));
  const canOffer = !!me && !!t.holder && t.holder !== me.toBase58() && a >= 0;
  const why = blocked(c, { spend: p.plantCost + (prem ?? 0n) }) ?? (prem === null ? "Проверьте премию" : null);
  const gap = a >= 0 ? model.alive[idx] - model.alive[a] : 0;
  return (
    <div className="card swap-card">
      <div className="card-title">⇄ Квантовый SWAP</div>
      <p className="muted small">Обмен содержимым двух клеток с вероятностью p. Премия уходит принявшему при любом исходе — это цена риска. После принятия сделка обязательна для клеток, даже при смене владельца.</p>
      {canOffer && (
        <>
          <label className="field">Моя клетка
            <select value={a} onChange={(e) => setFrom(Number(e.target.value))}>{myBlocks.map((i) => <option key={i} value={i}>#{i} · {model.alive[i]} живых</option>)}</select>
          </label>
          <label className="field">Вероятность обмена p = {weight / 100}%
            <input type="range" min={500} max={10_000} step={500} value={weight} onChange={(e) => setWeight(Number(e.target.value))} aria-valuetext={`${weight / 100} процентов`} />
          </label>
          <AmountField label="Премия принявшему" value={premium} onChange={setPremium} allowZero hint={`ожидаемый выигрыш: ${((gap * weight) / 10_000).toFixed(1)} живых клеток; сбор ${rcr(p.plantCost)} (80% сжигается)`} />
          <button className="btn portal" disabled={!!why} onClick={() => c.run({
            title: "Предложение квантового SWAP",
            lines: [`«${c.cur!.acc.name}»: ваша #${a} ⇄ #${idx} (${shortAddr(t.holder!)})`, `Вероятность обмена ${weight / 100}%`, `Сбор ${rcr(p.plantCost)}: 80% сжигается, 20% — награда резолверу`, `Премия ${rcr(prem!)} — в эскроу, при отмене вернётся`],
            ixs: [c.rx.swapOffer(me!, k, a, idx, weight, prem!)], successText: "SWAP предложен",
          })}>Предложить SWAP · {rcr(p.plantCost + (prem ?? 0n))}</button>
          {why && <div className="field-hint">{why}</div>}
        </>
      )}
      {!canOffer && related.length === 0 && <div className="muted small">{!me ? "Подключите кошелёк" : t.holder === me.toBase58() ? "Выберите чужую клетку, чтобы предложить обмен" : myBlocks.length === 0 ? "Нужна своя клетка в этом мире" : "Клетка свободна"}</div>}
      {related.map(({ key, acc: s }) => {
        const slot = BigInt(c.slot);
        const expired = !s.accepted && slot > s.expirySlot;
        return (
          <div key={key.toBase58()} className="swap-row small">
            <div>#{s.indexA} ⇄ #{s.indexB} · p={s.weightBps / 100}% · премия {rcr(s.premium)}</div>
            <div className="muted">{s.accepted ? (slot > s.targetSlot ? "готов к разрешению" : `ждёт слота ${s.targetSlot}`) : expired ? "истекло" : `открыто ${slotsToHuman(s.expirySlot - slot)}`}</div>
            <div className="row-wrap">
              {me && !s.accepted && !expired && s.acceptor.equals(me) && <button className="btn portal" onClick={() => c.run({ title: "Принять SWAP", lines: [`#${s.indexA} ⇄ #${s.indexB} с вероятностью ${s.weightBps / 100}%`, `Премия ${rcr(s.premium)} поступит вам при разрешении`, `Исход решит хеш слота через ${QUANTUM_DELAY_SLOTS} слотов`], ixs: [c.rx.swapAccept(me, k, s.indexA, s.indexB)] })}>Принять · +{rcr(s.premium)}</button>}
              {me && s.accepted && slot > s.targetSlot && <button className="btn" onClick={() => c.run({ title: "Разрешить SWAP", lines: ["Измерение по SlotHashes", `Награда: ${rcr(s.bounty)}`], ixs: c.withAta([c.rx.swapResolve(me, k, s.indexA, s.indexB, s.offerer, s.acceptor)]) })}>Разрешить · +{rcr(s.bounty)}</button>}
              {me && !s.accepted && (s.offerer.equals(me) || expired) && <button className="btn" onClick={() => c.run({ title: "Отменить SWAP", lines: [`Премия ${rcr(s.premium)} вернётся предложившему`, ...(expired && !s.offerer.equals(me) ? [`Ваша награда: ${rcr(s.bounty)}`] : [])], ixs: c.withAta([c.rx.swapCancel(me, k, s.indexA, s.indexB, s.offerer)]) })}>Отменить</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RebellionCard({ c, idx }: { c: ChainCtx; idx: number }) {
  const w = c.cur!.acc;
  const t = c.detail.territories.get(idx);
  const active = BigInt(c.slot) <= w.rebellionDeadline && w.rebellionId > 0;
  const voted = !!t && t.votedRebellion === w.rebellionId;
  return (
    <div className="card danger-card">
      <div className="card-title">✊ Восстание против архитектора</div>
      <p className="small">Архитектор берёт {w.architectFeeBps / 100}% с тиков. Если ≥⅔ владельцев клеток (минимум {REBELLION_MIN_VOTES}) проголосуют — мир станет свободным навсегда, а накопления архитектора распределятся.</p>
      {active
        ? <div className="small">Идёт восстание #{w.rebellionId}: голосов {w.rebellionVotes} · до слота {w.rebellionDeadline.toString()}</div>
        : <div className="muted small">Восстание не идёт</div>}
      <div className="row-wrap">
        {!active && <button className="btn danger" disabled={!!blocked(c)} onClick={() => c.run({ title: "Начать восстание", lines: [`Мир «${w.name}»`, "Ваш голос засчитывается сразу", "Нужна клетка, купленная до начала голосования"], ixs: [c.rx.startRebellion(c.me!, c.cur!.key, idx)] })}>Начать восстание</button>}
        {active && !voted && <button className="btn danger" disabled={!!blocked(c)} onClick={() => c.run({ title: "Голос за восстание", lines: [`Клетка #${idx} голосует за свободу мира «${w.name}»`], ixs: [c.rx.voteRebellion(c.me!, c.cur!.key, idx)] })}>Голосовать</button>}
        {active && voted && <span className="small">Вы проголосовали ✓</span>}
      </div>
    </div>
  );
}

