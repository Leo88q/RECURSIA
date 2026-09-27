// @vitest-environment happy-dom
// Live mode end-to-end against a mock JSON-RPC serving real account layouts:
// world list, deep links, cell/world/wallet/agents tabs, neutral SWAP card, lab —
// and a guard against runaway RPC polling (render→fetch loops).
import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { accountDiscriminator, DEFAULT_PARAMS, Pdas, PROGRAM_ID, Writer, writeParams, writePending, GRID, TERRITORIES } from "@recursia/sdk";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_t, k) => (k === "canvas" ? null : () => {}), set: () => true })) as any;
(window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

class B { a: number[] = []; u8(v: number) { this.a.push(v & 255); return this; } bool(v: boolean) { return this.u8(v ? 1 : 0); }
  u16(v: number) { return this.u8(v).u8(v >> 8); } u32(v: number) { for (let i = 0; i < 4; i++) this.u8(v >>> (8 * i)); return this; }
  u64(v: bigint) { for (let i = 0n; i < 8n; i++) this.u8(Number((v >> (8n * i)) & 255n)); return this; }
  pk(p: PublicKey) { this.a.push(...p.toBytes()); return this; } raw(b: Uint8Array) { this.a.push(...b); return this; }
  name(s: string) { const b = new Uint8Array(32); b.set(new TextEncoder().encode(s)); return this.raw(b); } done() { return Uint8Array.from(this.a); } }

const pda = new Pdas(PROGRAM_ID);
const D = PublicKey.default;
const holder = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
function config(): Uint8Array {
  const b = new B().raw(accountDiscriminator("Config")).u8(1).u8(255).u8(0).u8(0).u8(0).u8(0).pk(holder).pk(pda.mint()).bool(true).bool(false);
  const w = new Writer(); writeParams(w, DEFAULT_PARAMS); writePending(w, { kind: "None" } as any); b.raw(w.done());
  b.u64(0n).u64(0n); // eta, nonce
  b.u64(2n).u64(2n).u64(1n).u64(3n).u64(0n).u64(0n).u64(0n).u64(0n).u64(0n).u64(5_000_000_000n).u64(0n);
  return b.done();
}
function world(name: string, index: bigint, neutral: boolean): Uint8Array {
  const b = new B().raw(accountDiscriminator("World")).u8(1).u8(255).u8(255).u8(0).pk(D).u8(0).u64(index).pk(neutral ? D : holder).u16(neutral ? 0 : 500).pk(pda.module(0))
    .u16(1 << 3).u16((1 << 2) | (1 << 3)).name(name);
  for (let i = 0; i < GRID; i++) b.u64(i % 3 === 0 ? 0x0000183c3c180000n : 0n);
  b.u64(1234n).u64(300n).u64(1000n).u64(0n).u64(500_000_000n).u64(0n).u64(0n).u64(0n);
  for (let i = 0; i < TERRITORIES; i++) b.u16(i % 3 === 0 ? 12 : 0);
  for (let i = 0; i < TERRITORIES; i++) b.u64(i === 5 ? 1_500_000n : 0n);
  b.u64(0n).u64(3n).u64(0n); for (let i = 0; i < TERRITORIES; i++) b.u32(0);
  b.u64(2n).u64(0n); for (let i = 0; i < TERRITORIES; i++) b.u32(0);
  b.bool(false).u16(10).u16(0).u32(0).u8(0).u64(0n).u64(0n).bool(neutral).u64(0n);
  b.u16(neutral ? 1 << 6 : 0).u16(0).u8(neutral ? 1 : 0).raw(new Uint8Array(32)).u64(0n).u16(0).bool(neutral);
  return b.done();
}
function territory(w: PublicKey, idx: number, who: PublicKey): Uint8Array {
  return new B().raw(accountDiscriminator("Territory")).u8(1).u8(255).pk(w).u8(idx).pk(who).u64(20_000_000n).u64(5_000_000n).u64(0n).u64(0n).u64(0n).u64(0n).u32(0).bool(false).pk(D).done();
}
const W0 = pda.rootWorld(0), W1 = pda.rootWorld(1);
const accounts = new Map<string, Uint8Array>([
  [pda.config().toBase58(), config()], [W0.toBase58(), world("Альфа", 0n, false)], [W1.toBase58(), world("Нейтралка", 1n, true)],
  [pda.territory(W0, 5).toBase58(), territory(W0, 5, holder)], [pda.territory(W0, 9).toBase58(), territory(W0, 9, holder)],
]);
const enc = (d: Uint8Array) => ({ data: [Buffer.from(d).toString("base64"), "base64"], executable: false, lamports: 1_000_000, owner: PROGRAM_ID.toBase58(), rentEpoch: 0, space: d.length });
const match = (d: Uint8Array, f: any) => !f.memcmp || Buffer.from(d.slice(f.memcmp.offset, f.memcmp.offset + bs58.decode(f.memcmp.bytes).length)).equals(Buffer.from(bs58.decode(f.memcmp.bytes)));
const calls: string[] = [];
function handle(m: string, p: any[]): any {
  calls.push(m);
  const ctx = { context: { slot: 5000 } };
  switch (m) {
    case "getAccountInfo": { const d = accounts.get(p[0]); return { ...ctx, value: d ? enc(d) : null }; }
    case "getMultipleAccounts": return { ...ctx, value: p[0].map((k: string) => (accounts.get(k) ? enc(accounts.get(k)!) : null)) };
    case "getProgramAccounts": return [...accounts.entries()].filter(([, d]) => (p[1]?.filters ?? []).every((f: any) => match(d, f))).map(([k, d]) => ({ pubkey: k, account: enc(d) }));
    case "getSlot": return 5000;
    case "getLatestBlockhash": return { ...ctx, value: { blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 9999 } };
    case "getRecentPrioritizationFees": return [];
    default: return null;
  }
}

describe("live mode smoke (mock RPC)", () => {
  it("renders worlds, cells, tabs, deep links", async () => {
    const server = http.createServer((req, res) => {
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" }); res.end(); return; }
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
        const j = JSON.parse(body); const one = (q: any) => ({ jsonrpc: "2.0", id: q.id, result: handle(q.method, q.params ?? []) });
        res.setHeader("content-type", "application/json"); res.setHeader("access-control-allow-origin", "*"); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;
    vi.stubEnv("VITE_CLUSTER", "localnet"); vi.stubEnv("VITE_RPC_URL", `http://127.0.0.1:${port}`); vi.stubEnv("VITE_WS_URL", "ws://127.0.0.1:1");
    const errors: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
    localStorage.setItem("recursia:intro:v1", "1");
    location.hash = "#/chain";
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App } = await import("../src/App");
    const { ToastProvider } = await import("../src/ui/Toast");
    const root = document.createElement("div"); document.body.appendChild(root);
    const r = createRoot(root);
    await act(async () => { r.render(<ToastProvider><App /></ToastProvider>); });
    const wait = async (pred: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await act(async () => { await new Promise((x) => setTimeout(x, 100)); }); };
    const text = () => document.body.textContent ?? "";
    await wait(() => text().includes("Альфа"));
    expect(text()).toContain("Альфа");
    expect(text()).toContain("Нейтралка");
    expect(document.querySelector("canvas")).toBeTruthy();
    // pick cell 5 (held) via keyboard: from default 27 go to 5 → use deep link instead
    await act(async () => { location.hash = `#/chain/${W0.toBase58()}/5`; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await wait(() => text().includes("Клетка #5") && text().includes("Выкупить"));
    expect(text()).toContain("Выкупить");
    for (const tab of ["Мир", "Кошелёк", "ИИ-агенты"]) {
      const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent === tab) as HTMLButtonElement;
      b.click();
      await act(async () => { await new Promise((x) => setTimeout(x, 50)); });
      expect((document.querySelector('[role="tabpanel"]')?.textContent ?? "").length).toBeGreaterThan(10);
      if (tab === "Мир") expect(text()).toContain("Время мира");
    }
    expect(text()).toContain("Подключите кошелёк");
    // neutral world, free cell
    await act(async () => { location.hash = `#/chain/${W1.toBase58()}/3`; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const cellTab = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent === "Клетка") as HTMLButtonElement;
    await act(async () => { cellTab.click(); });
    await wait(() => text().includes("Квантовый SWAP"));
    expect(text()).toContain("Занять");
    // chain lab
    await act(async () => { location.hash = "#/chain/lab"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await wait(() => text().includes("Редактор законов"));
    expect(text()).toContain("Редактор законов");
    const crashes = errors.filter((e) => /crashed|is not a function|Cannot read|undefined is not/.test(e));
    expect(crashes).toEqual([]);
    const gma = calls.filter((c) => c === "getMultipleAccounts").length;
    expect(gma).toBeLessThan(40);
    console.error = orig;
    r.unmount(); server.close();
  }, 60_000);
});
