// @vitest-environment happy-dom
// End-to-end smoke of the real app shell: landing, sandbox (lazy chunk), keyboard, sim steps, tabs, lab.
import { describe, expect, it } from "vitest";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === "canvas" ? null : () => {}), set: () => true })) as any;
(window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const errors: string[] = [];
const origErr = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };

describe("smoke", () => {
  it("renders landing, sandbox, lab without crashing", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("../src/App");
    const { ToastProvider } = await import("../src/ui/Toast");
    const { ErrorBoundary } = await import("../src/ui/ErrorBoundary");
    const root = document.createElement("div"); document.body.appendChild(root);
    const r = createRoot(root);
    await act(async () => { r.render(<ErrorBoundary><ToastProvider><App /></ToastProvider></ErrorBoundary>); });
    const text = () => document.body.textContent ?? "";
    expect(text()).toContain("RECURSIA");
    // first visit → landing with rules and entry cost
    expect(text()).toContain("Сколько стоит вход");
    expect(text()).toContain("Правила игры");
    expect(document.querySelector("canvas")).toBeNull(); // simulator chunk not loaded yet
    // "Играть бесплатно" → sandbox (lazy Game chunk)
    await act(async () => { (document.querySelector('.l-hero a[href="#/play"]') as HTMLAnchorElement).click(); });
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    for (let i = 0; i < 50 && !document.querySelector("canvas"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(location.hash).toBe("#/play");
    // select a cell via keyboard on the canvas
    const canvas = document.querySelector("canvas")!;
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(location.hash).toMatch(/#\/sandbox\/root-0\/28/);
    expect(text()).toContain("Клетка #28");
    // run some sim steps via the "шаг" button
    const step = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "один шаг")!;
    for (let i = 0; i < 30; i++) await act(async () => { step.click(); });
    // wallet tab
    const walletTab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes("Кошелёк")) as HTMLButtonElement;
    await act(async () => { walletTab.click(); });
    expect(text()).toContain("Нанять ИИ-жителя");
    // lab
    await act(async () => { location.hash = "#/lab"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(text()).toContain("Редактор законов");
    // back to the landing via deep link to a section
    await act(async () => { location.hash = "#/faq"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(text()).toContain("Частые вопросы");
    expect(document.querySelector(".me-pill")).toBeNull(); // sandbox header strip is gone with the game
    // legal pages: footer link on every page → privacy / terms / cookies / risk (checklist 7.1 / 4.3)
    for (const [hash, marker] of [
      ["#/privacy", "Оператор и контакты"],
      ["#/terms", "Запрещённые действия"],
      ["#/cookies", "Cookies — не используются"],
      ["#/risk", "Не финансовый совет"],
    ] as const) {
      await act(async () => { location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(text()).toContain(marker);
      expect(document.querySelector(".app-footer-links")).not.toBeNull();
    }
    const crashes = errors.filter((e) => /crashed|Uncaught|is not a function|Cannot read/.test(e));
    console.error = origErr;
    expect(crashes).toEqual([]);
    r.unmount();
  }, 60_000);
});
