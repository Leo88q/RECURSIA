import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { RecursiaIx, ruleString, type WorldAccount } from "@recursia/sdk";
import { WorldCanvas } from "../WorldCanvas";
import { CONFIG, CLUSTER_LABEL } from "../lib/config";
import { MINT } from "./mint";
import { compact, shortAddr } from "../lib/format";
import type { Route } from "../lib/route";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Skeleton, Spinner } from "../ui/fields";
import { useProgramData, useMyData, useWorldDetail, useVisible, type Keyed } from "./data";
import { useTx } from "./tx";
import { toModel } from "./toModel";
import type { ChainCtx } from "./ctx";
import { CellPanel } from "./CellPanel";
import { WorldPanel } from "./WorldPanel";
import { AgentsPanel, WalletPanel } from "./WalletPanel";
import { CreateWorldButton } from "./CreateWorld";
import { ChainLab } from "./ChainLab";
import { Art, WorldIcon } from "../ui/Icon";
import hero from "../assets/art/hero.webp";

type Tab = "cell" | "world" | "wallet" | "agents";
const TABS: Array<[Tab, string]> = [["cell", "Клетка"], ["world", "Мир"], ["wallet", "Кошелёк"], ["agents", "ИИ-агенты"]];

export function ChainView({ route, go }: { route: Extract<Route, { page: "chain" | "chain-lab" }>; go: (r: Route, replace?: boolean) => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const programId = useMemo(() => new PublicKey(CONFIG.programId), []);
  const rx = useMemo(() => new RecursiaIx(programId, MINT), [programId]);
  const data = useProgramData(connection, programId);
  const me = wallet.publicKey;
  const my = useMyData(connection, programId, me);
  const run = useTx();
  const [tab, setTab] = useState<Tab>("cell");
  const [frame, setFrame] = useState(0);
  const visible = useVisible();

  const worldKey = route.page === "chain" ? route.world ?? data.worlds[0]?.key.toBase58() : undefined;
  const cur = data.worlds.find((w) => w.key.toBase58() === worldKey) ?? null;
  const detail = useWorldDetail(connection, programId, cur ? worldKey ?? null : null, worldKey ? data.worldVersion.get(worldKey) ?? 0 : 0);
  const model = useMemo(() => (cur ? toModel(cur.key, cur.acc, detail.territories) : null), [cur, detail.territories]);
  const selected = route.page === "chain" ? route.cell ?? null : null;

  // refresh everything after any confirmed transaction
  useEffect(() => {
    const on = () => { data.refresh(); my.refresh(); };
    window.addEventListener("recursia:tx", on);
    return () => window.removeEventListener("recursia:tx", on);
  }, [data.refresh, my.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!visible) return; const i = setInterval(() => setFrame((f) => f + 1), 140); return () => clearInterval(i); }, [visible]);

  const openWorld = useCallback((key: string, cell?: number) => { go({ page: "chain", world: key, cell }); setTab(cell !== undefined ? "cell" : "world"); }, [go]);
  const selectCell = useCallback((i: number | null) => { if (worldKey) go({ page: "chain", world: worldKey, cell: i ?? undefined }, true); if (i !== null) setTab("cell"); }, [go, worldKey]);
  const withAta = useCallback((ixs: TransactionInstruction[]) => (me && my.rcr === null ? [rx.createAtaIdempotent(me, me), ...ixs] : ixs), [me, my.rcr, rx]);

  if (data.config === undefined) return (
    <div className="chain-empty art-screen" aria-busy="true">
      <div className="art-screen-hero" aria-hidden="true"><img src={hero} alt="" width={1200} height={593} /></div>
      <div className="art-screen-body"><div className="row-wrap"><Spinner /> Подключение к {CLUSTER_LABEL[CONFIG.cluster]}…</div><Skeleton lines={3} /></div>
    </div>
  );
  if (data.config === null) return (
    <div className="chain-empty art-screen">
      <div className="art-screen-hero" aria-hidden="true"><img src={hero} alt="" width={1200} height={593} /></div>
      <div className="art-screen-body">
        <h2><Art name="coin" size={30} />{data.error ? "Сеть сейчас недоступна" : `Мультивселенная ещё не открыта в ${CLUSTER_LABEL[CONFIG.cluster]}`}</h2>
        <p>{data.error
          ? "Не удалось связаться с узлом Solana. Проверьте подключение или повторите через минуту — ваши средства в сети не зависят от этого сайта."
          : "Контракт RECURSIA на этом кластере ещё не развёрнут. Пока можно играть в «Песочнице» — там те же правила, что и в контракте, только время идёт быстрее."}</p>
        <div className="row-wrap">
          <a className="btn primary" href="#/play"><Art name="world" size={20} /> Играть в песочнице</a>
          <button className="btn" onClick={() => data.refresh()}>Повторить</button>
        </div>
        <details className="tech">
          <summary>Технические детали (для операторов)</summary>
          {data.error && <p className="sim bad small">{data.error}</p>}
          <p className="small">Кластер: <b>{CLUSTER_LABEL[CONFIG.cluster]}</b><br />RPC: <code>{new URL(CONFIG.rpcUrl).host}</code><br />Program ID: <code>{CONFIG.programId}</code></p>
          <p className="small muted">Развёртывание: <code>docs/DEPLOY.md</code> (мультисиг Squads как админ → <code>initialize</code> с mint SKR → <code>fund_reward_pool</code>), переменные <code>VITE_PROGRAM_ID</code> / <code>VITE_MINT</code> / <code>VITE_RPC_URL</code> / <code>VITE_CLUSTER</code>.</p>
        </details>
      </div>
    </div>
  );

  // Checklist: never sign against a contract bound to a different token (fake "SKR" with the same name).
  if (!data.config.mint.equals(MINT)) return (
    <div className="chain-empty art-screen" role="alert">
      <div className="art-screen-body">
        <h2><Art name="coin" size={30} />Контракт настроен на другой токен</h2>
        <p>Программа {CONFIG.programId} работает с mint <code>{data.config.mint.toBase58()}</code>, а этот клиент — с <code>{MINT.toBase58()}</code>. Действия отключены, чтобы вы не подписали транзакцию с поддельным токеном.</p>
        <a className="btn primary" href="#/play"><Art name="world" size={20} /> Играть в песочнице</a>
      </div>
    </div>
  );

  const c: ChainCtx = { rx, programId, config: data.config, data, my, me, cur, model, detail, slot: data.slot, run, withAta, openWorld, selectCell };

  if (route.page === "chain-lab") return <ErrorBoundary label="chain-lab"><ChainLab c={c} /></ErrorBoundary>;

  return (
    <div className="chain">
      <aside className="left" aria-label="Список вселенных">
        <div className="panel-title"><Art name="coin" size={18} />Ончейн-вселенные</div>
        <ProtocolStatus c={c} />
        <WorldList worlds={data.worlds} current={worldKey} onPick={(k) => openWorld(k)} />
        <div className="stack">
          <CreateWorldButton c={c} kind="root" />
          <CreateWorldButton c={c} kind="neutral" />
        </div>
        <div className="card small muted notice">
          Официальная программа: <code>{shortAddr(CONFIG.programId, 6)}</code>. RECURSIA никогда не просит seed-фразу, не пишет в личку и не предлагает «ИИ-помощника» для подписи. Каждая транзакция симулируется и показывается до подписи.
        </div>
      </aside>

      <main className="center" aria-label="Карта мира">
        {cur && model ? (
          <>
            <Breadcrumbs worlds={data.worlds} cur={cur} onPick={(k) => openWorld(k)} />
            <WorldCanvas world={model} selected={selected} onSelect={(i) => selectCell(i)} onDescend={(id) => openWorld(id)} frame={frame} zoomFrom={null}
              superposed={[...detail.superpositions.keys()]} youKey={me?.toBase58()} />
            <div className="controls">
              <span className="muted small mono">{ruleString(cur.acc.birth, cur.acc.survive, cur.acc.qBirth, cur.acc.qSurvive, cur.acc.qAmp)}</span>
              <span className="muted small">поколение {cur.acc.generation.toLocaleString("ru-RU")} · энергия {compact(cur.acc.energy)} SKR · слот {data.slot.toLocaleString("ru-RU")}</span>
              {detail.loading && <Spinner label="Загрузка клеток" />}
            </div>
          </>
        ) : (
          <div className="chain-empty">
            <h2>{worldKey ? "Мир не найден" : "Миров пока нет"}</h2>
            <p className="muted">{worldKey ? "Проверьте ссылку или выберите мир слева." : "Создайте первую вселенную — вы станете её архитектором."}</p>
          </div>
        )}
      </main>

      <aside className="right" aria-label="Действия">
        <div className="wallet-row"><WalletMultiButton /></div>
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div role="tabpanel">
          <ErrorBoundary label={`chain-${tab}`} compact key={`${tab}-${worldKey}-${selected}`}>
            {tab === "cell" && (selected === null || !cur
              ? <div className="panel-body muted">Выберите клетку 8×8 на карте (клавиатура: стрелки + Enter). Фиолетовая рамка — вложенная вселенная.</div>
              : <CellPanel c={c} idx={selected} />)}
            {tab === "world" && <WorldPanel c={c} />}
            {tab === "wallet" && <WalletPanel c={c} />}
            {tab === "agents" && <AgentsPanel c={c} />}
          </ErrorBoundary>
        </div>
      </aside>
    </div>
  );
}

function ProtocolStatus({ c }: { c: ChainCtx }) {
  const cfg = c.config;
  return (
    <div className="proto">
      <div className="muted small">Эпоха {cfg.curEpoch.toString()} · миров {cfg.totalWorlds.toString()} · в пул наград пришло {compact(cfg.totalSunk)} SKR</div>
      {cfg.paused && <div className="sim bad small" role="status">Протокол на паузе: новые действия недоступны, вывод средств работает.</div>}
      {cfg.pending.kind !== "None" && <div className="card danger-card small">Ожидает таймлока: <b>{cfg.pending.kind}</b> · не раньше {new Date(Number(cfg.pendingEta) * 1000).toLocaleString("ru-RU")}</div>}
      {c.data.error && <div className="sim bad small">RPC: {c.data.error}</div>}
    </div>
  );
}

function WorldList({ worlds, current, onPick }: { worlds: Array<Keyed<WorldAccount>>; current?: string; onPick: (k: string) => void }) {
  const [q, setQ] = useState("");
  const byParent = new Map<string, Array<Keyed<WorldAccount>>>();
  for (const w of worlds) { const p = w.acc.parent.equals(PublicKey.default) ? "" : w.acc.parent.toBase58(); byParent.set(p, [...(byParent.get(p) ?? []), w]); }
  const filter = q.trim().toLowerCase();
  const node = (w: Keyed<WorldAccount>): React.ReactNode => {
    const k = w.key.toBase58();
    const kids = byParent.get(k) ?? [];
    const pop = w.acc.territoryAlive.reduce((a, b) => a + b, 0);
    return (
      <li key={k}>
        <button className={`tree-node ${k === current ? "active" : ""}`} aria-current={k === current ? "page" : undefined} onClick={() => onPick(k)}>
          <span className={`dot ${w.acc.energy > 0n ? "live" : "dead"}`} />
          <WorldIcon neutral={w.acc.neutral} depth={w.acc.depth} /><span className="tree-name">{w.acc.name}</span>
          {w.acc.qAmp > 0 && <Art name="quantum" size={15} className="tag-ico" title="квантовые законы" />}
          <span className="tree-pop">{pop}</span>
        </button>
        {kids.length > 0 && !filter && <ul>{kids.map(node)}</ul>}
      </li>
    );
  };
  const roots = filter ? worlds.filter((w) => w.acc.name.toLowerCase().includes(filter)) : byParent.get("") ?? [];
  return (
    <>
      {worlds.length > 8 && <input className="search" placeholder="Поиск мира…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск мира" />}
      <ul className="tree">{roots.map(node)}</ul>
    </>
  );
}

function Breadcrumbs({ worlds, cur, onPick }: { worlds: Array<Keyed<WorldAccount>>; cur: Keyed<WorldAccount>; onPick: (k: string) => void }) {
  const chain: Array<Keyed<WorldAccount>> = [];
  for (let w: Keyed<WorldAccount> | undefined = cur; w && chain.length < 10; w = worlds.find((x) => x.key.equals(w!.acc.parent))) chain.unshift(w);
  return (
    <nav className="crumbs" aria-label="Путь по вселенным">
      {chain.map((w, i) => (
        <span key={w.key.toBase58()}>
          {i > 0 && <span className="sep"> › </span>}
          <button className={w === cur ? "crumb on" : "crumb"} aria-current={w === cur ? "page" : undefined} onClick={() => onPick(w.key.toBase58())}>{w.acc.name}</button>
        </span>
      ))}
    </nav>
  );
}
