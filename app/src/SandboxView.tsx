import { useEffect, useState } from "react";
import { YOU, type Sandbox } from "./sandbox";
import { WorldCanvas } from "./WorldCanvas";
import { Chronicle, TerritoryPanel, WalletPanel, WorldPanel, WorldTree } from "./panels";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { useNotify } from "./ui/Toast";
import type { Route } from "./lib/route";
import { Art, Glyph } from "./ui/Icon";
import { Onboarding } from "./ui/Onboarding";

type Tab = "cell" | "world" | "wallet";
const TABS: Array<[Tab, string, React.ReactNode]> = [["cell", "Клетка", <Art name="cell" size={20} />], ["world", "Мир", <Art name="world" size={18} />], ["wallet", "Кошелёк и ИИ", <Art name="coin" size={18} />]];
const SPEEDS = [0, 1, 2, 5, 10];

export function SandboxView({ sb, route, go, speed, setSpeed, frame, bump }: {
  sb: Sandbox; route: Extract<Route, { page: "sandbox" }>; go: (r: Route, replace?: boolean) => void;
  speed: number; setSpeed: (s: number) => void; frame: number; bump: () => void;
}) {
  const notifyToast = useNotify();
  const notify = (err: string | null, ok?: string) => { notifyToast(err, ok); bump(); };
  const [tab, setTab] = useState<Tab>("cell");
  const [zoomFrom, setZoomFrom] = useState<number | null>(null);
  const world = (route.world && sb.m.worlds.get(route.world)) || sb.m.world("root-0");
  const selected = route.cell ?? null;
  const setWorld = (id: string, cell?: number) => go({ page: "sandbox", world: id === "root-0" && cell === undefined ? undefined : id, cell });
  const select = (i: number | null) => { go({ page: "sandbox", world: world.id, cell: i ?? undefined }, true); if (i !== null) setTab("cell"); };

  const chain: string[] = [];
  for (let w: typeof world | undefined = world; w; w = w.parent ? sb.m.world(w.parent) : undefined) chain.unshift(w.id);

  const descend = (id: string) => {
    setZoomFrom(sb.m.world(id).parentTerritory);
    setWorld(id);
    setTab("world");
    setTimeout(() => setZoomFrom(null), 700);
  };

  // Space = pause/resume (when focus is not in a form field)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== " " || /INPUT|SELECT|TEXTAREA|BUTTON|CANVAS/.test(el.tagName) || document.querySelector(".modal")) return;
      e.preventDefault(); setSpeed(speed === 0 ? 2 : 0);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [speed, setSpeed]);

  return (
    <div className="layout">
      <aside className="left" aria-label="Мультивселенная">
        <ErrorBoundary label="onboarding" compact>
          <Onboarding sb={sb} frame={frame} setSpeed={setSpeed} notify={notify} goCell={(p) => { go({ page: "sandbox", world: p.world, cell: p.idx }); setTab("cell"); }} />
        </ErrorBoundary>
        <div className="panel-title"><Art name="nested" size={18} />Мультивселенная</div>
        <WorldTree sb={sb} current={world.id} onPick={(id) => { setWorld(id); setTab("world"); }} />
        <div className="legend-box">
          <div><span className="dot live" /> живёт</div>
          <div><span className="dot dormant" /> спит (хост мёртв)</div>
          <div><span className="dot dead" /> без энергии</div>
          <div><i className="sw you" /> ваши клетки · <i className="sw ai" /> ИИ и другие</div>
        </div>
      </aside>

      <main className="center" id="main" aria-label="Карта мира">
        <nav className="crumbs" aria-label="Путь по вселенным">
          {chain.map((id, i) => (
            <span key={id}>
              {i > 0 && <span className="sep"> › </span>}
              <button className={id === world.id ? "crumb on" : "crumb"} aria-current={id === world.id ? "page" : undefined} onClick={() => setWorld(id)}>{sb.m.world(id).name}</button>
            </span>
          ))}
          <span className="gen">поколение {world.generation.toLocaleString("ru-RU")}</span>
        </nav>
        <WorldCanvas world={world} selected={selected} onSelect={select} onDescend={descend} frame={frame} zoomFrom={zoomFrom} superposed={sb.superposedIn(world.id)} youKey={YOU} />
        <div className="controls" role="toolbar" aria-label="Скорость времени">
          <span className="muted small">Время:</span>
          {SPEEDS.map((s) => <button key={s} className={speed === s ? "chip on" : "chip"} aria-pressed={speed === s} onClick={() => setSpeed(s)} aria-label={s === 0 ? "пауза" : `скорость ×${s}`}>{s === 0 ? <Glyph name="pause" size={14} /> : `×${s}`}</button>)}
          <button className="chip" onClick={() => { sb.step(); bump(); }} aria-label="один шаг"><Glyph name="step" size={13} /> шаг</button>
          <span className="muted small">слот {sb.m.slot.toLocaleString("ru-RU")}</span>
        </div>
        <Chronicle sb={sb} worldId={world.id} />
      </main>

      <aside className="right" aria-label="Действия">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label, ico]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{ico}<span>{label}</span></button>)}
        </div>
        <div role="tabpanel">
          <ErrorBoundary label={`sandbox-${tab}`} compact key={`${tab}-${world.id}-${selected}`}>
            {tab === "cell" && (selected === null
              ? <div className="panel-body empty-state"><Art name="cell" size={48} className="empty-ico" /><p>Выберите клетку 8×8 на карте (или стрелками с клавиатуры).</p><p className="muted small"><Art name="nested" size={16} /> Двойной клик / Enter по фиолетовому порталу — войти во вложенную вселенную. <kbd>Пробел</kbd> — пауза.</p></div>
              : <TerritoryPanel key={`${world.id}-${selected}`} sb={sb} world={world} idx={selected} onDescend={descend} notify={notify} />)}
            {tab === "world" && <WorldPanel sb={sb} world={world} notify={notify} />}
            {tab === "wallet" && <WalletPanel sb={sb} notify={notify} />}
          </ErrorBoundary>
        </div>
      </aside>
    </div>
  );
}
