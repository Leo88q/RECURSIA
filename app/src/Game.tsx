// Sandbox + physics lab: the offline multiverse. A separate chunk, so the landing
// page opens without shipping the simulator, AI agents and canvas code.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sandbox, YOU, fmtRcr } from "./sandbox";
import { EconomyStrip } from "./panels";
import { PhysicsLab } from "./lab";
import { SandboxView } from "./SandboxView";
import type { Route } from "./lib/route";
import { useVisible } from "./lib/visible";
import { useNotify } from "./ui/Toast";
import { Art } from "./ui/Icon";

// One multiverse per page load: it survives trips to the landing / live mode and back.
let shared: Sandbox | null = null;
const getSandbox = () => (shared ??= new Sandbox(42));

export default function Game({ route, go, headerSlot }: {
  route: Extract<Route, { page: "sandbox" | "lab" }>;
  go: (r: Route, replace?: boolean) => void;
  /** Header element the economy strip / balance are portalled into. */
  headerSlot: HTMLElement | null;
}) {
  const [sb] = useState(getSandbox);
  const [speed, setSpeed] = useState(2);
  const [, setVersion] = useState(0);
  const [frame, setFrame] = useState(0);
  const visible = useVisible();
  const notify = useNotify();
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Animation clock (portals / ψ shimmer) — only while the sandbox is on screen.
  useEffect(() => {
    if (route.page !== "sandbox" || !visible) return;
    const i = setInterval(() => setFrame((f) => f + 1), 110);
    return () => clearInterval(i);
  }, [route.page, visible]);

  // The multiverse keeps living while you are in the lab; it pauses on other pages and in background tabs.
  useEffect(() => {
    if (speed === 0 || !visible) return;
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
  }, [speed, sb, visible, bump]);

  const me = sb.m.players.get(YOU)!;
  return (
    <>
      {headerSlot && createPortal(
        <>
          <EconomyStrip sb={sb} />
          <div className="me-pill" aria-label="Ваш тестовый баланс"><Art name="coin" size={18} /> {YOU}: <b>{fmtRcr(me.wallet)}</b></div>
        </>,
        headerSlot,
      )}
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
    </>
  );
}
