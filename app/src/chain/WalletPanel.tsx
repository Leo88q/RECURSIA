import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { MAX_PERMIT_SLOTS_FALLBACK, PERMIT_ACQUIRE, PERMIT_PLANT } from "./permits";
import { lamportsToSol, rcr, shortAddr, slotsToHuman } from "../lib/format";
import { AmountField, Address, amountOf } from "../ui/fields";
import { blocked, type ChainCtx } from "./ctx";
import { Glyph, Art } from "../ui/Icon";
import { SeasonCard, SponsorCard } from "../ui/Season";
import { SEASON_EPOCHS, TOURNAMENT_JOIN_EPOCHS, TOURNAMENT_MAX_PLAYERS, TOURNAMENT_TIERS, tournamentPlaces } from "@recursia/sdk";
import { TournamentCard } from "../ui/Tournament";

const isDefaultKey = (k: PublicKey) => k.equals(PublicKey.default);

/** Season leaderboard, prizes and sponsor pool (live data; all actions are permissionless program calls). */
function SeasonSection({ c }: { c: ChainCtx }) {
  const { me, my, rx, config } = c;
  const s = c.data.season;
  if (!me) return null;
  const label = (k: PublicKey) => (k.equals(me) ? "Вы" : shortAddr(k.toBase58()));
  const myPoints = my.player && my.player.seasonId === config.seasonId ? my.player.seasonPoints : 0n;
  const inTop = s?.top.some((e) => e.player.equals(me)) ?? false;
  const betterThanLast = !s || isDefaultKey(s.top[s.top.length - 1].player) || myPoints > s.top[s.top.length - 1].points || inTop;
  const submitBlocked = blocked(c) ?? (myPoints === 0n ? "Сначала соберите награды с клеток — это и есть очки" : !betterThanLast ? "Очков пока мало для топ-10" : null);
  const epochsLeft = Number(config.seasonStartEpoch) + SEASON_EPOCHS - Number(config.curEpoch) - 1;
  return (
    <>
      <SeasonCard
        seasonId={Number(config.seasonId)} epochsLeft={epochsLeft} pool={c.data.pools.season}
        top={(s?.top ?? []).filter((e) => !isDefaultKey(e.player)).map((e) => ({ label: label(e.player), points: e.points, you: e.player.equals(me) }))}
        myPoints={myPoints} submitBlocked={submitBlocked}
        onSubmit={() => c.run({ title: "Заявить очки сезона", lines: [`Очки: ${rcr(myPoints)}`, "Программа сама вставит вас в топ-10 по очкам из вашего аккаунта игрока — подделать их нельзя"], ixs: [rx.seasonSubmit(me)], successText: "Очки в таблице" }).then(() => c.data.refresh())}
        last={s && s.lastId > 0n ? { id: Number(s.lastId), rows: s.lastTop.map((e, r) => ({ label: isDefaultKey(e.player) ? "—" : label(e.player), points: e.points, you: e.player.equals(me), prize: isDefaultKey(e.player) ? 0n : s.lastPrizes[r], claimed: (s.lastClaimed & (1 << r)) !== 0 })) } : null}
        onClaim={(r) => c.run({ title: "Зачислить приз сезона", lines: [`${r + 1}-е место: ${rcr(s!.lastPrizes[r])} → «к выводу» победителя`, "Отправить может любой, деньги получает только победитель"], ixs: [rx.claimSeasonPrize(s!.lastTop[r].player, r)], successText: "Приз зачислен" }).then(() => c.data.refresh())}
        claimBlocked={blocked(c, { paused: false })}
        fmt={(v) => rcr(v, 0)}
      />
      <SponsorCard pool={c.data.pools.sponsor} fmt={(v) => rcr(v, 0)} parse={(v) => amountOf(v)}
        blockedWhy={(a) => (a === null ? "Введите сумму" : blocked(c, { spend: a }))}
        onFund={(a) => { c.run({ title: "Спонсировать живые миры", lines: [`${rcr(a)} → спонсорский пул`, "Невозвратно: пул раздаётся мирам по 10% за эпоху пропорционально живым клеткам"], danger: "Это пожертвование в пул наград, а не вклад: вернуть его нельзя.", ixs: [rx.fundSponsorPool(me, a)], successText: "Спасибо! Живые миры получат больше" }).then(() => c.data.refresh()); }} />
    </>
  );
}

/** Season tournaments: entry fee → top 30% by (program-counted) season points. */
function TournamentSection({ c }: { c: ChainCtx }) {
  const { me, my, rx, config } = c;
  if (!me) return null;
  const label = (k: PublicKey) => (k.equals(me) ? "Вы" : shortAddr(k.toBase58()));
  const season = config.seasonId;
  const joinOpen = config.curEpoch < config.seasonStartEpoch + BigInt(TOURNAMENT_JOIN_EPOCHS);
  const myPoints = my.player && my.player.seasonId === season ? my.player.seasonPoints : 0n;
  const find = (s: bigint, tier: number) => c.data.tournaments.find((t) => t.acc.seasonId === s && t.acc.tier === tier);
  const refresh = () => { c.data.refresh(); my.refresh(); };
  return (
    <TournamentCard
      seasonId={Number(season)} joinOpen={joinOpen}
      tiers={TOURNAMENT_TIERS.map((mult, tier) => {
        const t = find(season, tier);
        const fee = t ? t.acc.entryFee : config.params.plantCost * mult;
        const joined = !!t && my.tournamentEntries.has(t.key.toBase58());
        const players = t?.acc.players ?? 0;
        return {
          tier, fee, players, max: TOURNAMENT_MAX_PLAYERS, pot: t?.acc.pot ?? 0n, joined, paidPlaces: tournamentPlaces(players),
          top: (t?.acc.top ?? []).filter((e) => !isDefaultKey(e.player)).map((e) => ({ label: label(e.player), points: e.points, you: e.player.equals(me) })),
          joinBlocked: blocked(c, { spend: fee }) ?? (!joinOpen ? "Регистрация закрыта до следующего сезона" : players >= TOURNAMENT_MAX_PLAYERS ? "Турнир заполнен" : null),
          submitBlocked: blocked(c) ?? (myPoints === 0n ? "Соберите награды с клеток — это и есть очки" : null),
        };
      })}
      finished={c.data.tournaments.filter((t) => t.acc.seasonId < season && my.tournamentEntries.has(t.key.toBase58())).slice(-2).map((t) => ({
        seasonId: Number(t.acc.seasonId), tier: t.acc.tier, settled: t.acc.settled, pot: t.acc.pot,
        rows: t.acc.top.map((e, r) => ({ label: isDefaultKey(e.player) ? "—" : label(e.player), points: e.points, you: e.player.equals(me), prize: t.acc.prizes[r], claimed: (t.acc.claimed & (1 << r)) !== 0 })),
      }))}
      onJoin={(tier) => { const fee = find(season, tier)?.acc.entryFee ?? config.params.plantCost * TOURNAMENT_TIERS[tier]; c.run({
        title: "Участие в турнире", lines: [`Взнос ${rcr(fee)}: 90% — в банк турнира, 10% — студии`, "Призы: лучшие 30% участников по очкам сезона, после окончания сезона"],
        danger: "Взнос не возвращается: если вы не попадёте в призовые 30%, он достанется победителям.",
        ixs: c.withAta([rx.tournamentJoin(me, season, tier)]), successText: "Вы в турнире",
      }).then(refresh); }}
      onSubmit={(tier) => { c.run({ title: "Обновить очки турнира", lines: [`Очки: ${rcr(myPoints)} — программа берёт их из вашего аккаунта игрока`], ixs: [rx.tournamentSubmit(me, season, tier)], successText: "Очки обновлены" }).then(refresh); }}
      onSettle={(s, tier) => { c.run({ title: "Подвести итоги турнира", lines: ["Фиксирует призы; неразыгранная часть банка уходит в пул наград"], ixs: [rx.tournamentSettle(BigInt(s), tier)], successText: "Итоги подведены" }).then(refresh); }}
      onClaim={(s, tier, r) => { const t = find(BigInt(s), tier)!; c.run({ title: "Зачислить приз турнира", lines: [`${r + 1}-е место: ${rcr(t.acc.prizes[r])} → «к выводу» победителя`], ixs: [rx.claimTournamentPrize(t.acc.top[r].player, BigInt(s), tier, r)], successText: "Приз зачислен" }).then(refresh); }}
      actionBlocked={blocked(c, { paused: false })} fmt={(v) => rcr(v, 0)}
    />
  );
}

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
      <SeasonSection c={c} />
      <TournamentSection c={c} />
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
