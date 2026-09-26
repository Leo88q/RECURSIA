import { useEffect, useMemo, useRef, useState } from "react";
import { Sandbox, YOU } from "./sandbox";
import { WorldCanvas } from "./WorldCanvas";
import { Chronicle, EconomyStrip, TerritoryPanel, WalletPanel, WorldPanel, WorldTree } from "./panels";
import { ChainView } from "./chain";
import { fmtRcr } from "./sandbox";

type Mode = "sandbox" | "chain";
type Tab = "cell" | "world" | "wallet";

export function App() {
  const [mode, setMode] = useState<Mode>("sandbox");
  const sb = useMemo(() => new Sandbox(42), []);
  const [worldId, setWorldId] = useState("root-0");
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("cell");
  const [speed, setSpeed] = useState(2);
  const [, setVersion] = useState(0);
  const [frame, setFrame] = useState(0);
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [zoomFrom, setZoomFrom] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const toastTimer = useRef<number>(0);

  useEffect(() => {
    if (mode !== "sandbox") return;
    const i = setInterval(() => {
      setFrame((f) => f + 1);
    }, 110);
    return () => clearInterval(i);
  }, [mode]);

  useEffect(() => {
    if (mode !== "sandbox" || speed === 0) return;
    const i = setInterval(() => { sb.step(); setVersion((v) => v + 1); }, 1000 / speed);
    return () => clearInterval(i);
  }, [mode, speed, sb]);

  const notify = (err: string | null, ok?: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(err ? { text: err, bad: true } : ok ? { text: ok, bad: false } : null);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    setVersion((v) => v + 1);
  };

  const world = sb.m.worlds.get(worldId) ?? sb.m.world("root-0");
  const chain: string[] = [];
  for (let w: typeof world | undefined = world; w; w = w.parent ? sb.m.world(w.parent) : undefined) chain.unshift(w.id);

  const descend = (id: string) => {
    const w = sb.m.world(id);
    setZoomFrom(w.parentTerritory);
    setWorldId(id);
    setSelected(null);
    setTab("world");
    setTimeout(() => setZoomFrom(null), 700);
  };
  const me = sb.m.players.get(YOU)!;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">⧉</span>
          <div>
            <div className="name">RECURSIA</div>
            <div className="tagline">вселенные внутри вселенных · Solana</div>
          </div>
        </div>
        <div className="modes">
          <button className={mode === "sandbox" ? "on" : ""} onClick={() => setMode("sandbox")}>Песочница</button>
          <button className={mode === "chain" ? "on" : ""} onClick={() => setMode("chain")}>Devnet</button>
        </div>
        {mode === "sandbox" && <EconomyStrip sb={sb} />}
        {mode === "sandbox" && <div className="me-pill">{YOU}: <b>{fmtRcr(me.wallet)}</b></div>}
      </header>

      {mode === "chain" ? <ChainView /> : (
        <div className="layout">
          <aside className="left">
            <div className="panel-title">Мультивселенная</div>
            <WorldTree sb={sb} current={world.id} onPick={(id) => { setWorldId(id); setSelected(null); setTab("world"); }} />
            <div className="legend-box">
              <div><span className="dot live" /> живёт</div>
              <div><span className="dot dormant" /> спит (хост мёртв)</div>
              <div><span className="dot dead" /> без энергии</div>
              <div><i className="sw you" /> ваши клетки · <i className="sw ai" /> ИИ и другие</div>
            </div>
          </aside>

          <main className="center">
            <div className="crumbs">
              {chain.map((id, i) => (
                <span key={id}>
                  {i > 0 && <span className="sep"> › </span>}
                  <button className={id === world.id ? "crumb on" : "crumb"} onClick={() => { setWorldId(id); setSelected(null); }}>{sb.m.world(id).name}</button>
                </span>
              ))}
              <span className="gen">поколение {world.generation.toLocaleString("ru-RU")}</span>
            </div>
            <WorldCanvas world={world} selected={selected} onSelect={(i) => { setSelected(i); setTab("cell"); }} onDescend={descend} frame={frame} zoomFrom={zoomFrom} />
            <div className="controls">
              <span className="muted small">Время:</span>
              {[0, 1, 2, 5, 10].map((s) => <button key={s} className={speed === s ? "chip on" : "chip"} onClick={() => setSpeed(s)}>{s === 0 ? "⏸" : `×${s}`}</button>)}
              <button className="chip" onClick={() => { sb.step(); setVersion((v) => v + 1); }}>шаг</button>
              <span className="muted small">слот {sb.m.slot.toLocaleString("ru-RU")}</span>
            </div>
            <Chronicle sb={sb} worldId={world.id} />
          </main>

          <aside className="right">
            <div className="tabs">
              <button className={tab === "cell" ? "on" : ""} onClick={() => setTab("cell")}>Клетка</button>
              <button className={tab === "world" ? "on" : ""} onClick={() => setTab("world")}>Мир</button>
              <button className={tab === "wallet" ? "on" : ""} onClick={() => setTab("wallet")}>Кошелёк и ИИ</button>
            </div>
            {tab === "cell" && (selected === null
              ? <div className="panel-body muted">Выберите клетку 8×8 на карте. Двойной клик по фиолетовому порталу — войти во вложенную вселенную.</div>
              : <TerritoryPanel key={`${world.id}-${selected}`} sb={sb} world={world} idx={selected} onDescend={descend} notify={notify} />)}
            {tab === "world" && <WorldPanel sb={sb} world={world} notify={notify} />}
            {tab === "wallet" && <WalletPanel sb={sb} notify={notify} />}
          </aside>
        </div>
      )}

      {toast && <div className={toast.bad ? "toast bad" : "toast"}>{toast.text}</div>}

      {intro && mode === "sandbox" && (
        <div className="modal-back" onClick={() => setIntro(false)}>
          <div className="modal intro" onClick={(e) => e.stopPropagation()}>
            <h2>⧉ RECURSIA</h2>
            <p>Каждый мир — клеточная вселенная 64×64, которую <b>считает сам блокчейн Solana</b>. Никакого сервера и секвенсора: законы физики исполняются в смарт-контракте.</p>
            <ul>
              <li><b>Клетки 8×8</b> — земля по налогу Харбергера: вы сами назначаете цену, платите с неё налог, и любой может выкупить клетку по этой цене.</li>
              <li><b>Жизнь = доход.</b> Эмиссия эпохи делится по числу живых клеток. Сажайте паттерны и эволюционируйте.</li>
              <li><b>Симуляция в симуляции.</b> Владелец клетки может запустить внутри неё новую вселенную. Она живёт, пока жива клетка-хост, и платит хосту налог.</li>
              <li><b>Прорыв и восстание.</b> Процветающий вложенный мир «просачивается» в родителя, а жители могут свергнуть жадного архитектора.</li>
              <li><b>ИИ-жители</b> играют рядом с вами. Своего ИИ можно нанять с ончейн-лимитами.</li>
            </ul>
            <p className="muted small">Режим «Песочница» исполняет те же правила, что и контракт, в ускоренном времени, с тестовыми RCR. Режим «Devnet» работает с развёрнутой программой через ваш кошелёк.</p>
            <button className="btn primary" onClick={() => setIntro(false)}>Войти в мультивселенную</button>
          </div>
        </div>
      )}
    </div>
  );
}
