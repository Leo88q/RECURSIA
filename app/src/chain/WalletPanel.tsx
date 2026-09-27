import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { MAX_PERMIT_SLOTS_FALLBACK, PERMIT_ACQUIRE, PERMIT_PLANT } from "./permits";
import { lamportsToSol, rcr, shortAddr, slotsToHuman } from "../lib/format";
import { AmountField, Address, amountOf } from "../ui/fields";
import { blocked, type ChainCtx } from "./ctx";
import { Glyph, Art } from "../ui/Icon";

export function WalletPanel({ c }: { c: ChainCtx }) {
  const { me, my, rx } = c;
  const [amt, setAmt] = useState("");
  if (!me) return <div className="panel-body"><p className="muted">Подключите кошелёк (Phantom, Solflare, Backpack — любой с Wallet Standard), чтобы играть на блокчейне.</p></div>;
  const claimable = my.player?.claimable ?? 0n;
  const w = amountOf(amt || "0", { max: claimable });
  const myModules = c.data.modules.filter((m) => m.acc.author.equals(me) && m.acc.accrued > 0n);
  const worldName = (k: PublicKey) => c.data.worlds.find((x) => x.key.equals(k))?.acc.name ?? shortAddr(k.toBase58());
  return (
    <div className="panel-body">
      <div className="big-balance">{my.rcr === null ? "—" : rcr(my.rcr)}</div>
      <dl className="kv">
        <dt>Кошелёк</dt><dd><Address value={me.toBase58()} /></dd>
        <dt>SOL</dt><dd>{my.sol === null ? "…" : lamportsToSol(my.sol)}</dd>
        <dt>К выводу</dt><dd>{rcr(claimable)}</dd>
        <dt>Заработано всего</dt><dd>{rcr(my.player?.totalEarned ?? 0n)}</dd>
        <dt>Клеток</dt><dd>{my.holdings.length}</dd>
      </dl>
      {my.sol !== null && my.sol < 5_000_000 && <div className="sim bad small">Мало SOL: нужно ~0.005 SOL на комиссии и ренту аккаунтов.{c.config && " "}На devnet: <code>solana airdrop 1</code>.</div>}
      {my.rcr === null && (
        <div className="card">
          <div className="card-title"><Glyph name="vault" size={17} />Нет SKR-аккаунта</div>
          <p className="small muted">Создаётся один раз (рента ≈ 0.002 SOL). Без него нельзя получать и тратить SKR.</p>
          <button className="btn primary" onClick={() => c.run({ title: "Создание SKR-аккаунта", lines: ["Идемпотентное создание вашего ассоциированного токен-аккаунта SKR"], ixs: [rx.createAtaIdempotent(me, me)] })}>Создать</button>
        </div>
      )}
      <div className="card">
        <div className="card-title"><Art name="coin" size={20} />Вывод наград</div>
        <p className="muted small">Награды, роялти и выкупы копятся на балансе «к выводу» (pull-платежи). Вывод работает даже когда протокол на паузе.</p>
        <AmountField label="Сумма" value={amt} onChange={setAmt} max={claimable} hint={!amt ? "пусто = всё" : undefined} />
        <button className="btn primary" disabled={claimable === 0n || (amt !== "" && w === null) || !!blocked(c, { paused: false })} onClick={() => {
          const v = amt ? w! : claimable;
          c.run({ title: "Вывод SKR", lines: [`${rcr(v)} → ваш кошелёк`], ixs: c.withAta([rx.withdraw(me, v)]), successText: `Выведено ${rcr(v)}` }).then((r) => r.ok && setAmt(""));
        }}>Вывести {amt ? "" : rcr(claimable)}</button>
      </div>
      {myModules.length > 0 && (
        <div className="card">
          <div className="card-title"><Art name="law" size={21} />Роялти ваших законов</div>
          {myModules.map((m) => (
            <div key={m.key.toBase58()} className="agent-row">
              <span>«{m.acc.name}»</span>
              <button className="btn" onClick={() => c.run({ title: "Роялти автора", lines: [`«${m.acc.name}»: ${rcr(m.acc.accrued)} → к выводу`], ixs: [rx.claimModuleRoyalties(me, m.key)] })}>+{rcr(m.acc.accrued)}</button>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-title"><Art name="cell" size={20} />Ваши клетки</div>
        {my.holdings.length === 0 && <div className="muted small">Пока нет. Выберите свободную клетку на карте.</div>}
        {my.holdings.map((h) => (
          <button key={h.key.toBase58()} className="agent-row as-button" onClick={() => c.openWorld(h.acc.world.toBase58(), h.acc.index)}>
            <span>{worldName(h.acc.world)} #{h.acc.index}{h.acc.agentManaged && <Art name="agent" size={16} className="inline-ico" title="ИИ-агент" />}</span>
            <span className="muted small">цена {rcr(h.acc.price)} · депозит {rcr(h.acc.deposit)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentsPanel({ c }: { c: ChainCtx }) {
  const { me, my, rx } = c;
  const [agent, setAgent] = useState("");
  const [scope, setScope] = useState(PERMIT_PLANT | PERMIT_ACQUIRE);
  const [onlyHere, setOnlyHere] = useState(true);
  const [budget, setBudget] = useState("14000");
  const [limit, setLimit] = useState("3500");
  const [maxPrice, setMaxPrice] = useState("1400");
  const [days, setDays] = useState(7);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  if (!me) return <div className="panel-body muted">Подключите кошелёк</div>;
  let agentKey: PublicKey | null = null; let agentErr: string | null = null;
  if (agent) { try { agentKey = new PublicKey(agent.trim()); if (agentKey.equals(me)) agentErr = "агент не может быть вашим же кошельком"; else if (!PublicKey.isOnCurve(agentKey.toBytes())) agentErr = "адрес вне кривой (PDA) — агент должен подписывать"; } catch { agentErr = "некорректный адрес"; } }
  const b = amountOf(budget), l = amountOf(limit), mp = amountOf(maxPrice);
  const slots = BigInt(Math.min(days * 216_000, MAX_PERMIT_SLOTS_FALLBACK));
  const world = onlyHere && c.cur ? c.cur.key : PublicKey.default;
  const exists = agentKey ? my.permits.some((p) => p.acc.agent.equals(agentKey!)) : false;
  const why = blocked(c, { spend: b ?? 0n }) ?? (!agentKey ? "Укажите адрес агента" : agentErr ?? (exists ? "Разрешение для этого агента уже есть" : null) ?? (b === null || l === null || mp === null || scope === 0 ? "Проверьте поля" : null));
  return (
    <div className="panel-body">
      <div className="card">
        <div className="card-title"><Art name="agent" size={22} />Нанять ИИ-агента</div>
        <p className="muted small">Агент (ваш бот, сервис или ИИ) подписывает своим ключом, но тратит только из отдельного бюджета разрешения, только на разрешённые действия, с лимитом на эпоху и потолком цены. Вывести средства агент не может. Все лимиты проверяет смарт-контракт, а не промпт — prompt injection их не обойдёт.</p>
        <label className="field">Адрес агента<input value={agent} onChange={(e) => setAgent(e.target.value)} spellCheck={false} placeholder="публичный ключ агента" aria-invalid={!!agentErr} /></label>
        {agentErr && <div className="field-err">{agentErr}</div>}
        <fieldset className="field checks"><legend>Разрешено</legend>
          <label><input type="checkbox" checked={!!(scope & PERMIT_PLANT)} onChange={() => setScope(scope ^ PERMIT_PLANT)} /> сажать паттерны</label>
          <label><input type="checkbox" checked={!!(scope & PERMIT_ACQUIRE)} onChange={() => setScope(scope ^ PERMIT_ACQUIRE)} /> покупать клетки</label>
        </fieldset>
        <label className="small"><input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} disabled={!c.cur} /> только в мире «{c.cur?.acc.name ?? "—"}»</label>
        <AmountField label="Бюджет (переводится в хранилище разрешения)" value={budget} onChange={setBudget} max={my.rcr ?? undefined} />
        <AmountField label="Лимит трат за эпоху" value={limit} onChange={setLimit} />
        <AmountField label="Потолок цены клетки" value={maxPrice} onChange={setMaxPrice} />
        <label className="field">Срок: {days} дн.<input type="range" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <button className="btn primary" disabled={!!why} onClick={() => c.run({
          title: "Разрешение ИИ-агенту",
          lines: [`Агент ${shortAddr(agentKey!.toBase58(), 6)}`, `Действия: ${[scope & PERMIT_PLANT && "посадка", scope & PERMIT_ACQUIRE && "покупка"].filter(Boolean).join(", ")}`, `Мир: ${onlyHere && c.cur ? c.cur.acc.name : "любой"}`, `Бюджет ${rcr(b!)} · лимит ${rcr(l!)}/эпоху · потолок цены ${rcr(mp!)}`, `Истекает через ${days} дн.`],
          danger: "Указывайте только агента, которого контролируете. Никогда не вводите seed-фразу в «ИИ-помощников».",
          ixs: [rx.createPermit(me, agentKey!, scope, world, l!, mp!, slots), rx.fundPermit(me, agentKey!, b!)], successText: "Агент нанят",
        })}>Нанять · {b !== null ? rcr(b) : "—"}</button>
        {why && agent && <div className="field-hint">{why}</div>}
      </div>
      {my.permits.length > 0 && <div className="panel-title"><Art name="agent" size={21} />Ваши агенты</div>}
      {my.permits.map(({ key, acc: p }) => {
        const k = key.toBase58();
        const a = amountOf(amounts[k] ?? "");
        const left = Number(p.expirySlot) - c.slot;
        return (
          <div key={k} className="card">
            <div className="card-title"><Art name="agent" size={22} /><Address value={p.agent.toBase58()} /></div>
            <dl className="kv small">
              <dt>Действия</dt><dd>{[p.scope & PERMIT_PLANT && "посадка", p.scope & PERMIT_ACQUIRE && "покупка"].filter(Boolean).join(", ")}</dd>
              <dt>Мир</dt><dd>{p.allowedWorld.equals(PublicKey.default) ? "любой" : c.data.worlds.find((x) => x.key.equals(p.allowedWorld))?.acc.name ?? shortAddr(p.allowedWorld.toBase58())}</dd>
              <dt>Бюджет</dt><dd>{my.permitVaults.get(k) !== undefined ? rcr(my.permitVaults.get(k)!) : "…"}</dd>
              <dt>Потрачено</dt><dd>{rcr(p.spent)} / {rcr(p.maxSpendPerEpoch)} за эпоху</dd>
              <dt>Потолок цены</dt><dd>{rcr(p.maxPrice)}</dd>
              <dt>Срок</dt><dd>{left > 0 ? slotsToHuman(left) : <span className="danger-text">истёк</span>}</dd>
            </dl>
            <AmountField label="Сумма" value={amounts[k] ?? ""} onChange={(v) => setAmounts((m) => ({ ...m, [k]: v }))} />
            <div className="row-wrap">
              <button className="btn" disabled={a === null || !!blocked(c, { spend: a ?? 0n })} onClick={() => c.run({ title: "Пополнить бюджет агента", lines: [`+${rcr(a!)}`], ixs: [rx.fundPermit(me, p.agent, a!)] })}>Пополнить</button>
              <button className="btn" disabled={a === null || !!blocked(c, { paused: false })} onClick={() => c.run({ title: "Вернуть бюджет агента", lines: [`${rcr(a!)} → ваш кошелёк`], ixs: c.withAta([rx.withdrawPermit(me, p.agent, a!)]) })}>Вернуть</button>
              <button className="btn danger" disabled={!!blocked(c, { paused: false })} onClick={() => c.run({ title: "Отозвать разрешение", lines: ["Агент немедленно теряет доступ", "Остаток бюджета вернётся на ваш кошелёк", "Аккаунт разрешения закрывается, рента возвращается"], ixs: c.withAta([rx.revokePermit(me, p.agent)]) })}>Отозвать</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
