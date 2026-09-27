// @vitest-environment happy-dom
// End-to-end smoke of the real app shell: intro, sandbox, keyboard, sim steps, tabs, lab, live-mode fallback.
import { describe, expect, it } from "vitest";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === "canvas" ? null : () => {}), set: () => true })) as any;
(window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const errors: string[] = [];
const origErr = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };

describe("smoke", () => {
  it("renders sandbox, lab, chain without crashing", async () => {
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
    expect(text()).toContain("Войти в мультивселенную");
    // close intro
    await act(async () => { (document.querySelector(".modal .btn.primary") as HTMLButtonElement).click(); });
    expect(localStorage.getItem("recursia:intro:v1")).toBe("1");
    // select a cell via keyboard on the canvas
    const canvas = document.querySelector("canvas")!;
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(location.hash).toMatch(/#\/sandbox\/root-0\/28/);
    expect(text()).toContain("Клетка #28");
    // run some sim steps via the "шаг" button
    const step = [...document.querySelectorAll("button")].find((b) => b.textContent === "шаг")!;
    for (let i = 0; i < 30; i++) await act(async () => { step.click(); });
    // wallet tab
    const walletTab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes("Кошелёк")) as HTMLButtonElement;
    await act(async () => { walletTab.click(); });
    expect(text()).toContain("Нанять ИИ-жителя");
    // lab
    await act(async () => { location.hash = "#/lab"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(text()).toContain("Редактор законов");
    const crashes = errors.filter((e) => /crashed|Uncaught|is not a function|Cannot read/.test(e));
    console.error = origErr;
    expect(crashes).toEqual([]);
    r.unmount();
  }, 60_000);
});
