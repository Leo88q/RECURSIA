import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Sandbox, YOU, fmtRcr } from "./sandbox";
import { EconomyStrip } from "./panels";
import { PhysicsLab } from "./lab";
import { SandboxView } from "./SandboxView";
import { CONFIG, CLUSTER_LABEL } from "./lib/config";
import { useRoute, type Route } from "./lib/route";
import { useVisible } from "./lib/visible";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Modal } from "./ui/Modal";
import { Skeleton, Spinner } from "./ui/fields";
import { useNotify } from "./ui/Toast";

// Live mode (wallet adapter + RPC stack) is a separate chunk, fetched on demand.
const ChainApp = lazy(() => import("./chain/ChainApp"));
const INTRO_KEY = "recursia:intro:v1";

export function App() {
  const [route, go] = useRoute();
  const sb = useMemo(() => new Sandbox(42), []);
  const [speed, setSpeed] = useState(2);
  const [, setVersion] = useState(0);
  const [frame, setFrame] = useState(0);
  const [intro, setIntro] = useState(() => { try { return localStorage.getItem(INTRO_KEY) !== "1"; } catch { return true; } });
  const visible = useVisible();
  const notify = useNotify();
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const live = route.page === "chain" || route.page === "chain-lab";

  // Animation clock (portals / ψ shimmer) — only while the sandbox is on screen.
  useEffect(() => {
    if (route.page !== "sandbox" || !visible) return;
    const i = setInterval(() => setFrame((f) => f + 1), 110);
    return () => clearInterval(i);
  }, [route.page, visible]);

  // The multiverse keeps living while you are in the lab; it stops in live mode and in background tabs.
  useEffect(() => {
    if (live || speed === 0 || !visible) return;
    let last = performance.now();
    const period = 1000 / speed;
    const i = setInterval(() => {
      const now = performance.now();
      // never queue up more than 3 steps after a stall (slow device / long GC)
      const n = Math.min(3, Math.max(1, Math.floor((now - last) / period)));
      last = now;
      for (let k = 0; k < n; k++) sb.step();
      bump();
    }, period);
    return () => clearInterval(i);
  }, [live, speed, sb, visible, bump]);

  useEffect(() => {
    const titles: Record<Route["page"], string> = { sandbox: "Песочница", lab: "Лаборатория физики", chain: CLUSTER_LABEL[CONFIG.cluster], "chain-lab": `Лаборатория · ${CLUSTER_LABEL[CONFIG.cluster]}` };
    document.title = `${titles[route.page]} — RECURSIA`;
  }, [route.page]);

  const closeIntro = () => { setIntro(false); try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ } };
  const me = sb.m.players.get(YOU)!;
  const nav: Array<[Route, string, boolean]> = [
    [{ page: "sandbox" }, "Песочница", route.page === "sandbox"],
    [{ page: "lab" }, "⚗ Лаборатория", route.page === "lab"],
    [{ page: "chain" }, CLUSTER_LABEL[CONFIG.cluster], route.page === "chain"],
    [{ page: "chain-lab" }, `⚗ ${CLUSTER_LABEL[CONFIG.cluster]}`, route.page === "chain-lab"],
  ];

  return (
    <div className="app">
      <a href="#main" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>К содержимому</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="RECURSIA — на главную">
          <span className="logo" aria-hidden="true">⧉</span>
          <div>
            <div className="name">RECURSIA</div>
            <div className="tagline">вселенные внутри вселенных · Solana</div>
          </div>
        </a>
        <nav className="modes" aria-label="Режим">
          {nav.map(([r, label, on]) => <button key={label} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(r)}>{label}</button>)}
        </nav>
        {!live && <EconomyStrip sb={sb} />}
        {!live && <div className="me-pill" aria-label="Ваш тестовый баланс">{YOU}: <b>{fmtRcr(me.wallet)}</b></div>}
        {CONFIG.errors.length > 0 && <div className="cfg-bad" role="alert" title={CONFIG.errors.join("\n")}>⚠ конфигурация</div>}
      </header>

      {CONFIG.errors.length > 0 && live && (
        <div className="chain-empty" role="alert">
          <h2>Ошибка конфигурации деплоя</h2>
          <ul>{CONFIG.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <ErrorBoundary label={route.page} key={route.page}>
        {route.page === "sandbox" && <SandboxView sb={sb} route={route} go={go} speed={speed} setSpeed={setSpeed} frame={frame} bump={bump} />}
        {route.page === "lab" && (
          <main id="main" tabIndex={-1}>
            <PhysicsLab
              modules={sb.labModules()} fee={sb.m.params.moduleRegisterFee} feeBurnBps={sb.m.params.feeBurnBps} fmt={(v) => fmtRcr(v, 2)}
              onPublish={(law, name) => { const e = sb.publishLaw(law, name); bump(); return e; }}
              onClaim={(id) => { notify(sb.act(() => { sb.m.claimModuleRoyalties(YOU, id); }), "Роялти перенесены к выводу (Кошелёк → Вывести)"); bump(); }}
              note="Песочница: публикация тратит тестовые RCR. ИИ-демиурги начнут использовать ваш закон, если он жизнеспособен."
            />
          </main>
        )}
        {live && CONFIG.errors.length === 0 && (
          <Suspense fallback={<div className="chain-empty" aria-busy="true"><Spinner /> Загрузка модуля кошелька…<Skeleton lines={4} /></div>}>
            <main id="main" tabIndex={-1} className="live-main"><ChainApp route={route} go={go} /></main>
          </Suspense>
        )}
      </ErrorBoundary>

      {intro && route.page === "sandbox" && (
        <Modal title="⧉ RECURSIA" onClose={closeIntro} className="intro">
          <p>Каждый мир — клеточная вселенная 64×64, которую <b>считает сам блокчейн Solana</b>. Никакого сервера: законы физики исполняются в смарт-контракте.</p>
          <ul>
            <li><b>Клетки 8×8</b> — земля по налогу Харбергера: вы сами назначаете цену, платите с неё налог, и любой может выкупить клетку по этой цене.</li>
            <li><b>Жизнь = доход.</b> Эмиссия эпохи делится по числу живых клеток. Сажайте паттерны и эволюционируйте.</li>
            <li><b>Симуляция в симуляции.</b> Владелец клетки может запустить внутри неё новую вселенную.</li>
            <li><b>Квантовая физика.</b> Суперпозиции, запутанность и обмен исходами (SWAP) на энтропии блокчейна; свои законы физики с роялти.</li>
            <li><b>ИИ-жители</b> играют рядом с вами. Своего ИИ можно нанять с ончейн-лимитами.</li>
          </ul>
          <p className="muted small">«Песочница» исполняет те же правила, что и контракт, в ускоренном времени, с тестовыми RCR. Режим «{CLUSTER_LABEL[CONFIG.cluster]}» работает с развёрнутой программой через ваш кошелёк.</p>
          <button className="btn primary" data-autofocus onClick={closeIntro}>Войти в мультивселенную</button>
        </Modal>
      )}
    </div>
  );
}
