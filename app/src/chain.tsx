// Live on-chain mode. Reads program accounts, builds instructions with the SDK,
// ALWAYS simulates and shows a human-readable preview before asking the wallet
// to sign (checklist #51). Never touches private keys.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  PATTERNS, PROGRAM_ID, RecursiaIx, TERRITORIES, accountDiscriminator, ata, collapse, commitment, decodeConfig, decodeSuperposition,
  decodeTerritory, decodeWorld, epochTax, fmt, randomSalt, ruleString,
  type ConfigAccount, type MWorld, type SuperpositionAccount, type TerritoryAccount, type WorldAccount,
} from "@recursia/sdk";
import { WorldCanvas } from "./WorldCanvas";

const programId = new PublicKey(import.meta.env.VITE_PROGRAM_ID ?? PROGRAM_ID.toBase58());
const rx = new RecursiaIx(programId);

function toModel(key: PublicKey, w: WorldAccount, terr: Map<number, TerritoryAccount>): MWorld {
  const def = PublicKey.default;
  return {
    id: key.toBase58(), name: w.name, parent: w.parent.equals(def) ? null : w.parent.toBase58(), parentTerritory: w.parentTerritory,
    depth: w.depth, architect: w.architect.equals(def) ? null : w.architect.toBase58(), architectFeeBps: w.architectFeeBps,
    module: 0, birth: w.birth, survive: w.survive, grid: w.grid, generation: Number(w.generation), tickCount: Number(w.tickCount),
    lastTickSlot: Number(w.lastTickSlot), energy: w.energy, rewardsReserved: w.rewardsReserved, deposits: w.deposits,
    architectAccrued: w.architectAccrued, vault: 0n, alive: w.territoryAlive, pending: w.territoryPending,
    territories: Array.from({ length: TERRITORIES }, (_, i) => {
      const t = terr.get(i);
      const held = t && !t.holder.equals(def);
      return {
        holder: held ? t!.holder.toBase58() : null, price: t?.price ?? 0n, deposit: t?.deposit ?? 0n, lastTaxSlot: Number(t?.lastTaxSlot ?? 0n),
        lastPriceChange: Number(t?.lastPriceChangeSlot ?? 0n), nextPlantTick: Number(t?.nextPlantTick ?? 0n), acquiredSlot: Number(t?.acquiredSlot ?? 0n),
        votedRebellion: t?.votedRebellion ?? 0, agent: t?.agentManaged ?? false, childWorld: t && !t.childWorld.equals(def) ? t.childWorld.toBase58() : null,
      };
    }),
    epochId: Number(w.epochId), burnCur: w.burnCur, scoresCur: w.scoresCur, prevEpochId: Number(w.prevEpochId), burnPrev: w.burnPrev,
    scoresPrev: w.scoresPrev, prevClaimed: w.prevClaimed, resonance: w.resonance, children: [], rebellionId: w.rebellionId,
    rebellionVotes: w.rebellionVotes, rebellionDeadline: Number(w.rebellionDeadline), lastRebellionSlot: Number(w.lastRebellionSlot),
    liberated: w.liberated, totalBurned: w.totalBurned, history: [],
    key: key.toBytes(), qBirth: w.qBirth, qSurvive: w.qSurvive, qAmp: w.qAmp,
    entropy: w.entropy.some((b) => b !== 0) ? w.entropy : null, quantumEscrow: w.quantumEscrow, superpositions: w.superpositions,
  };
}

// ---- superposition secrets (preimage never leaves the browser) -----------
// Stored in localStorage BEFORE the commit is signed, so a crash between
// signing and saving cannot lose it. Losing it = the stake decoheres (burned).
interface StoredSecret { a: string; b: string; w: number; salt: string }
const secretKey = (world: PublicKey, idx: number, owner: PublicKey) => `recursia:psi:${world.toBase58()}:${idx}:${owner.toBase58()}`;
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
function loadSecret(world: PublicKey, idx: number, owner: PublicKey): { a: bigint; b: bigint; w: number; salt: Uint8Array } | null {
  try {
    const s = JSON.parse(localStorage.getItem(secretKey(world, idx, owner)) ?? "null") as StoredSecret | null;
    return s ? { a: BigInt(s.a), b: BigInt(s.b), w: s.w, salt: fromHex(s.salt) } : null;
  } catch { return null; }
}
function saveSecret(world: PublicKey, idx: number, owner: PublicKey, a: bigint, b: bigint, w: number, salt: Uint8Array) {
  const v: StoredSecret = { a: a.toString(), b: b.toString(), w, salt: toHex(salt) };
  localStorage.setItem(secretKey(world, idx, owner), JSON.stringify(v));
}
function exportSecret(world: PublicKey, idx: number, owner: PublicKey) {
  const raw = localStorage.getItem(secretKey(world, idx, owner));
  if (!raw) return;
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `recursia-psi-${idx}.json`; a.click(); URL.revokeObjectURL(url);
}

interface Preview { title: string; lines: string[]; ixs: TransactionInstruction[]; logs?: string[]; err?: string; units?: number }

export function ChainView() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [config, setConfig] = useState<ConfigAccount | null | undefined>(undefined);
  const [worlds, setWorlds] = useState<Array<{ key: PublicKey; acc: WorldAccount }>>([]);
  const [current, setCurrent] = useState<PublicKey | null>(null);
  const [territories, setTerritories] = useState<Map<number, TerritoryAccount>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<string>("");
  const [frame, setFrame] = useState(0);
  const [sp, setSp] = useState<SuperpositionAccount | null>(null);

  const load = useCallback(async () => {
    try {
      const cfgInfo = await connection.getAccountInfo(rx.pda.config());
      if (!cfgInfo || !cfgInfo.owner.equals(programId)) { setConfig(null); return; }
      setConfig(decodeConfig(cfgInfo.data));
      const res = await connection.getProgramAccounts(programId, { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator("World")) } }] });
      const list = res.map((r) => ({ key: r.pubkey, acc: decodeWorld(r.account.data) })).sort((a, b) => a.acc.depth - b.acc.depth || Number(a.acc.index - b.acc.index));
      setWorlds(list);
      setCurrent((c) => c ?? list[0]?.key ?? null);
    } catch (e) { setStatus(`RPC: ${(e as Error).message}`); }
  }, [connection]);

  const loadTerritories = useCallback(async (world: PublicKey) => {
    const res = await connection.getProgramAccounts(programId, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator("Territory")) } },
        { memcmp: { offset: 10, bytes: world.toBase58() } },
      ],
    });
    const map = new Map<number, TerritoryAccount>();
    for (const r of res) { const t = decodeTerritory(r.account.data); map.set(t.index, t); }
    setTerritories(map);
  }, [connection]);

  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);
  useEffect(() => { if (current) loadTerritories(current); }, [current, loadTerritories, worlds]);
  useEffect(() => { const i = setInterval(() => setFrame((f) => f + 1), 120); return () => clearInterval(i); }, []);
  useEffect(() => {
    setSp(null);
    if (!current || selected === null) return;
    connection.getAccountInfo(rx.pda.superposition(current, selected)).then((info) => {
      if (info && info.owner.equals(programId)) { try { setSp(decodeSuperposition(info.data)); } catch { /* layout mismatch */ } }
    }).catch(() => { /* */ });
  }, [connection, current, selected, worlds]);

  const cur = worlds.find((w) => current && w.key.equals(current));
  const model = useMemo(() => (cur ? toModel(cur.key, cur.acc, territories) : null), [cur, territories]);

  async function propose(title: string, lines: string[], ixs: TransactionInstruction[]) {
    if (!wallet.publicKey) { setStatus("Подключите кошелёк"); return; }
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sim = await connection.simulateTransaction(tx);
    setPreview({ title, lines, ixs, logs: sim.value.logs ?? [], err: sim.value.err ? JSON.stringify(sim.value.err) : undefined, units: sim.value.unitsConsumed });
  }

  async function confirm() {
    if (!preview || !wallet.publicKey) return;
    try {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...preview.ixs);
      const sig = await wallet.sendTransaction(tx, connection);
      setStatus(`Отправлено: ${sig.slice(0, 16)}…`);
      setPreview(null);
      await connection.confirmTransaction(sig, "confirmed");
      setStatus(`Подтверждено: ${sig.slice(0, 16)}…`);
      load();
    } catch (e) { setStatus(`Ошибка: ${(e as Error).message}`); }
  }

  if (config === undefined) return <div className="chain-empty">Подключение к {connection.rpcEndpoint}…</div>;
  if (config === null) return (
    <div className="chain-empty">
      <h2>Программа ещё не развёрнута на этом кластере</h2>
      <p>RPC: <code>{connection.rpcEndpoint}</code><br />Program ID: <code>{programId.toBase58()}</code></p>
      <p>Разверните контракт по инструкции <code>docs/DEPLOY.md</code> (мультисиг Squads как админ, затем <code>initialize</code> и <code>genesis</code>) и укажите <code>VITE_PROGRAM_ID</code> / <code>VITE_RPC_URL</code>.</p>
      <p className="muted">Пока можно играть в режиме «Песочница»: там работают те же правила, что и в контракте.</p>
      <WalletMultiButton />
    </div>
  );

  const me = wallet.publicKey;
  const t = selected !== null && model ? model.territories[selected] : null;
  const p = config.params;
  return (
    <div className="chain">
      <aside className="left">
        <div className="panel-title">Ончейн-вселенные</div>
        <div className="muted small">Эпоха {config.curEpoch.toString()} · миров {config.totalWorlds.toString()} · сожжено {fmt(config.totalBurned, 6, 0)} RCR{config.paused ? " · ПАУЗА" : ""}</div>
        <ul className="tree">{worlds.map((w) => (
          <li key={w.key.toBase58()} style={{ paddingLeft: w.acc.depth * 12 }}>
            <button className={`tree-node ${current && w.key.equals(current) ? "active" : ""}`} onClick={() => { setCurrent(w.key); setSelected(null); }}>
              <span className="tree-name">{w.acc.depth ? "⧉" : "◈"} {w.acc.name}{w.acc.qAmp > 0 ? " ⚛" : ""}</span><span className="tree-pop">{w.acc.territoryAlive.reduce((a, b) => a + b, 0)}</span>
            </button>
          </li>))}
        </ul>
        <div className="card small muted" title="Anti-drainer notice">
          Официальная программа: <code>{programId.toBase58().slice(0, 8)}…{programId.toBase58().slice(-6)}</code>.
          RECURSIA никогда не просит seed-фразу и не предлагает «ИИ-помощника» для подписи — только транзакции этой программы с превью.
        </div>
        {config.pending.kind !== "None" && <div className="card danger-card small">Ожидает таймлока: {config.pending.kind} · ETA {new Date(Number(config.pendingEta) * 1000).toLocaleString("ru-RU")}</div>}
      </aside>
      <main className="center">
        {model ? <WorldCanvas world={model} selected={selected} onSelect={setSelected} onDescend={(id) => setCurrent(new PublicKey(id))} frame={frame} zoomFrom={null} superposed={sp && selected !== null ? [selected] : []} /> : <div className="chain-empty">Миров пока нет</div>}
        {cur && (
          <div className="row-wrap">
            <button className="btn" onClick={() => propose("Тик мира", [`Мир: ${cur.acc.name}`, `Стоимость ${fmt(p.tickCost)} RCR из энергии мира`, `Ваша награда кранкера: ${p.crankerBps / 100}%`],
              [rx.createAtaIdempotent(me!, me!), rx.tick(me!, cur.key, cur.acc.module, cur.acc.parent.equals(PublicKey.default) ? null : cur.acc.parent)])} disabled={!me}>Тикнуть мир (+награда)</button>
            <span className="muted small">{ruleString(cur.acc.birth, cur.acc.survive, cur.acc.qBirth, cur.acc.qSurvive, cur.acc.qAmp)} · поколение {cur.acc.generation.toString()} · энергия {fmt(cur.acc.energy)} RCR</span>
          </div>
        )}
        {status && <div className="toast-inline">{status}</div>}
      </main>
      <aside className="right">
        <WalletMultiButton />
        {t && model && cur && selected !== null && (
          <div className="panel-body">
            <div className="title">Клетка #{selected}</div>
            <dl className="kv">
              <dt>Владелец</dt><dd className="mono">{t.holder ? `${t.holder.slice(0, 4)}…${t.holder.slice(-4)}` : "свободна"}</dd>
              <dt>Живых</dt><dd>{model.alive[selected]}</dd>
              <dt>Цена</dt><dd>{fmt(t.holder ? t.price : p.minPrice)} RCR</dd>
              <dt>Награды</dt><dd>{fmt(model.pending[selected])} RCR</dd>
            </dl>
            {me && t.holder !== me.toBase58() && (() => {
              const price = t.holder ? t.price : p.minPrice;
              const newPrice = price * 2n > p.minPrice ? price * 2n : p.minPrice;
              const dep = epochTax(newPrice, p.harbergerBps) * 3n;
              return <button className="btn primary" onClick={() => propose(t.holder ? "Выкуп клетки" : "Захват клетки",
                [`Мир ${cur.acc.name}, клетка #${selected}`, `Цена: ${fmt(price)} RCR (лимит = эта цена, защита от фронтраннинга)`, `Ваша новая цена: ${fmt(newPrice)} RCR`, `Депозит налога: ${fmt(dep)} RCR`, `Итого списание: ${fmt(price + dep)} RCR`],
                [rx.acquire(me, cur.key, selected, t.holder ? new PublicKey(t.holder) : null, price, newPrice, dep)])}>{t.holder ? "Выкупить" : "Занять"}</button>;
            })()}
            {me && t.holder === me.toBase58() && (
              <>
                <button className="btn" onClick={() => propose("Посадка глайдера", [`Клетка #${selected}`, `Сжигается ${fmt(p.plantCost)} RCR`], [rx.plant(me, cur.key, selected, 0x070402n)])}>Посадить глайдер</button>
                <button className="btn" onClick={() => propose("Сбор наград", [`${fmt(model.pending[selected])} RCR → ваш баланс к выводу`], [rx.collect(me, cur.key, selected)])}>Собрать</button>
              </>
            )}
            {me && t.holder === me.toBase58() && !sp && (
              <button className="btn portal" onClick={() => {
                const a = PATTERNS.glider, b = PATTERNS.acorn, w = 5_000, salt = randomSalt();
                saveSecret(cur.key, selected, me, a, b, w, salt);
                const c = commitment(a, b, w, salt, me.toBytes(), cur.key.toBytes(), selected);
                propose("Квантовая суперпозиция", [`Клетка #${selected}: |ψ⟩ = √½·|глайдер⟩ + √½·|жёлудь⟩`, `Сжигается ${fmt(p.plantCost)} RCR, залог ${fmt(p.plantCost * 4n)} RCR (вернётся при раскрытии)`,
                  "Секрет сохранён в этом браузере — не очищайте хранилище до коллапса"], [rx.quantumCommit(me, cur.key, selected, c)]);
              }}>⚛ Суперпозиция</button>
            )}
            {sp && (() => {
              const secret = me && sp.owner.equals(me) ? loadSecret(cur.key, selected, me) : null;
              const pv = sp.observed && secret ? collapse(sp.entropy, sp.commitment, secret.w) : null;
              return (
                <div className="card quantum-card">
                  <div className="card-title">ψ Суперпозиция</div>
                  <div className="small">{sp.observed ? `Наблюдали в слоте ${sp.observedSlot}; раскрыть до ${sp.revealDeadline}` : `Ждёт энтропии слота ${sp.targetSlot}`} · залог {fmt(sp.stake)} RCR</div>
                  {pv && <div className="small">Исход: ветвь <b>{pv.branchA ? "A" : "B"}</b>{pv.tunnel ? " + туннелирование" : ""}</div>}
                  {me && !sp.observed && <button className="btn" onClick={() => propose("Наблюдение", ["Фиксирует энтропию слота для этой суперпозиции", `Награда наблюдателя: ${fmt(sp.stake / 20n)} RCR`],
                    [rx.createAtaIdempotent(me, me), rx.quantumObserve(me, cur.key, selected)])}>👁 Наблюдать</button>}
                  {me && secret && sp.observed && <button className="btn portal" onClick={() => propose("Коллапс волновой функции", [`Раскрытие коммита клетки #${selected}`, `Возврат залога ${fmt(sp.stake)} RCR`],
                    [rx.quantumCollapse(me, cur.key, selected, secret.a, secret.b, secret.w, secret.salt, sp.world2.equals(PublicKey.default) ? null : { world: sp.world2, index: sp.index2 })])}>⚛ Коллапс</button>}
                  {me && secret && <button className="btn" onClick={() => exportSecret(cur.key, selected, me)}>Скачать секрет</button>}
                  {me && sp.owner.equals(me) && !secret && <div className="small danger-text">Секрет не найден в этом браузере — импортируйте файл секрета, иначе залог сгорит.</div>}
                  {me && <button className="btn" onClick={() => propose("Декогеренция", ["Доступно только после окна раскрытия", `Награда: ${fmt(sp.stake / 20n)} RCR, остальное сжигается`],
                    [rx.createAtaIdempotent(me, me), rx.quantumDecohere(me, cur.key, selected, sp.owner)])}>Декогеренция</button>}
                </div>
              );
            })()}
            {me && <button className="btn" onClick={() => propose("Создание RCR-аккаунта", ["Идемпотентное создание вашего токен-аккаунта RCR", `ATA: ${ata(me, rx.pda.mint()).toBase58().slice(0, 8)}…`], [rx.createAtaIdempotent(me, me)])}>Создать RCR-аккаунт</button>}
          </div>
        )}
      </aside>
      {preview && (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{preview.title}</h3>
            <ul>{preview.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <div className={preview.err ? "sim bad" : "sim ok"}>
              Симуляция: {preview.err ? `ОШИБКА ${preview.err}` : `успешно · ${preview.units ?? "?"} CU`}
            </div>
            <details><summary>Логи программы</summary><pre>{preview.logs?.join("\n")}</pre></details>
            <p className="muted small">Проверьте адрес программы: <code>{programId.toBase58()}</code>. Официальные адреса публикуются только в README репозитория.</p>
            <div className="row-wrap">
              <button className="btn" onClick={() => setPreview(null)}>Отмена</button>
              <button className="btn primary" disabled={!!preview.err} onClick={confirm}>Подписать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
