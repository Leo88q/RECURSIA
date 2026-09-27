import { lazy, Suspense, useEffect, useState } from "react";
import { CONFIG, CLUSTER_LABEL } from "./lib/config";
import { useRoute, type Route } from "./lib/route";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Skeleton, Spinner } from "./ui/fields";
import { Art, Glyph } from "./ui/Icon";
import { Landing } from "./Landing";

// Heavy parts are separate chunks, fetched on demand: the landing opens without them.
//  - Game: simulator, AI agents, canvas, physics lab (offline sandbox)
//  - ChainApp: wallet adapter + RPC stack (live mode)
const Game = lazy(() => import("./Game"));
const ChainApp = lazy(() => import("./chain/ChainApp"));

const TITLES: Record<Route["page"], string> = {
  landing: "Правила, старт и стоимость входа",
  sandbox: "Песочница",
  lab: "Лаборатория физики",
  chain: CLUSTER_LABEL[CONFIG.cluster],
  "chain-lab": `Лаборатория · ${CLUSTER_LABEL[CONFIG.cluster]}`,
};

function Loading({ label }: { label: string }) {
  return <div className="chain-empty" aria-busy="true"><Spinner /> {label}<Skeleton lines={4} /></div>;
}

export function App() {
  const [route, go] = useRoute();
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const live = route.page === "chain" || route.page === "chain-lab";
  const game = route.page === "sandbox" || route.page === "lab";

  useEffect(() => { document.title = `${TITLES[route.page]} — RECURSIA`; }, [route.page]);

  const nav: Array<[Route, string, boolean, React.ReactNode]> = [
    [{ page: "landing" }, "Об игре", route.page === "landing", <Art name="law" size={20} />],
    [{ page: "sandbox" }, "Песочница", route.page === "sandbox", <Art name="world" size={20} />],
    [{ page: "lab" }, "Лаборатория", route.page === "lab", <Art name="lab" size={20} />],
    [{ page: "chain" }, CLUSTER_LABEL[CONFIG.cluster], route.page === "chain", <Art name="coin" size={20} />],
    [{ page: "chain-lab" }, `Лаборатория · ${CLUSTER_LABEL[CONFIG.cluster]}`, route.page === "chain-lab", <><Art name="lab" size={20} /><Art name="coin" size={12} className="ico-badge" /></>],
  ];

  return (
    <div className="app">
      <a href="#main" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>К содержимому</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="RECURSIA — на главную">
          <Art name="logo" size={40} className="logo" />
          <div>
            <div className="name">RECURSIA</div>
            <div className="tagline">вселенные внутри вселенных · Solana</div>
          </div>
        </a>
        <nav className="modes" aria-label="Режим">
          {nav.map(([r, label, on, ico]) => (
            <button key={label} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(r)} title={label}>
              <span className="mode-ico">{ico}</span><span className={r.page === "chain-lab" ? "mode-label short" : "mode-label"}>{r.page === "chain-lab" ? `Лаб · ${CLUSTER_LABEL[CONFIG.cluster]}` : label}</span>
            </button>
          ))}
        </nav>
        <div className="header-slot" ref={setHeaderSlot} />
        {CONFIG.errors.length > 0 && <div className="cfg-bad" role="alert" title={CONFIG.errors.join("\n")}><Glyph name="warn" size={14} /> конфигурация</div>}
      </header>

      {CONFIG.errors.length > 0 && live && (
        <div className="chain-empty" role="alert">
          <h2>Ошибка конфигурации деплоя</h2>
          <ul>{CONFIG.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* sandbox ↔ lab share one boundary so switching between them keeps the game mounted */}
      <ErrorBoundary label={route.page} key={game ? "game" : route.page}>
        {route.page === "landing" && <Landing section={route.section} go={go} />}
        {(route.page === "sandbox" || route.page === "lab") && (
          <Suspense fallback={<Loading label="Загрузка мультивселенной…" />}>
            <Game route={route} go={go} headerSlot={headerSlot} />
          </Suspense>
        )}
        {live && CONFIG.errors.length === 0 && (
          <Suspense fallback={<Loading label="Загрузка модуля кошелька…" />}>
            <main id="main" tabIndex={-1} className="live-main"><ChainApp route={route} go={go} /></main>
          </Suspense>
        )}
      </ErrorBoundary>
    </div>
  );
}
