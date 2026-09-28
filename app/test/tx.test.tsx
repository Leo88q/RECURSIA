// @vitest-environment happy-dom
// Component test of the transaction pipeline (checklist #51/#72/#82): nothing
// is signed without a successful simulation + preview; foreign programs are
// refused; errors are decoded; the result resolves only after confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, ata, ORAO_VRF_ID, PROGRAM_ID, RecursiaIx, SKR_MINT, TOKEN_PROGRAM_ID } from "@recursia/sdk";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = Keypair.generate().publicKey;
const rx = new RecursiaIx(PROGRAM_ID);
const userAta = ata(me, SKR_MINT);

function tokenData(amount: bigint) {
  const d = new Uint8Array(165);
  new DataView(d.buffer).setBigUint64(64, amount, true);
  return d;
}
const b64 = (d: Uint8Array) => btoa(String.fromCharCode(...d));

let simResult: { err: unknown; logs: string[]; unitsConsumed: number; accounts: unknown[] };
const sent: Uint8Array[] = [];
const signTransaction = vi.fn(async <T,>(tx: T) => tx);
const connection = {
  rpcEndpoint: "mock",
  getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => keys.map((k) => (k.equals(me) ? { lamports: 2_000_000_000, data: new Uint8Array(0) } : k.equals(userAta) ? { lamports: 2_039_280, data: tokenData(100_000_000n) } : null))),
  getLatestBlockhash: vi.fn(async () => ({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 1000 })),
  simulateTransaction: vi.fn(async () => ({ context: { slot: 1 }, value: simResult })),
  getRecentPrioritizationFees: vi.fn(async () => [{ slot: 1, prioritizationFee: 4_000 }, { slot: 2, prioritizationFee: 6_000 }]),
  sendRawTransaction: vi.fn(async (raw: Uint8Array) => { sent.push(raw); return "sig"; }),
  confirmTransaction: vi.fn(async () => ({ context: { slot: 2 }, value: { err: null } })),
  getTransaction: vi.fn(async () => null),
};

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection }),
  useWallet: () => ({ publicKey: me, signTransaction, sendTransaction: vi.fn() }),
}));

const { TxProvider, useTx, refuseIx } = await import("../src/chain/tx");
const { ToastProvider } = await import("../src/ui/Toast");
type Result = Awaited<ReturnType<ReturnType<typeof useTx>>>;

let root: Root; let host: HTMLDivElement;
let runRef: ReturnType<typeof useTx>;
function Grab() { runRef = useTx(); return null; }

beforeEach(async () => {
  sent.length = 0; signTransaction.mockClear(); connection.sendRawTransaction.mockClear();
  simResult = { err: null, logs: ["Program log: ok"], unitsConsumed: 60_000, accounts: [{ lamports: 1_999_000_000, data: [b64(new Uint8Array(0)), "base64"] }, { lamports: 2_039_280, data: [b64(tokenData(80_000_000n)), "base64"] }] };
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<ToastProvider><TxProvider><Grab /></TxProvider></ToastProvider>); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

describe("tx pipeline", () => {
  it("simulate → preview with balance delta → sign → confirm → ok", async () => {
    let result: Result | undefined;
    await act(async () => { runRef({ title: "Тест", lines: ["строка превью"], ixs: [rx.withdraw(me, 1n)] }).then((r) => { result = r; }); });
    await flush();
    expect(text()).toContain("строка превью");
    expect(text()).toContain("Симуляция успешна");
    expect(text()).toMatch(/60\s000 CU/);
    expect(text()).toContain("100 → 80"); // SKR 100 → 80 from simulated post-state
    expect(text()).toContain("(−20)");
    expect(signTransaction).not.toHaveBeenCalled(); // nothing signed before the user clicks
    await act(async () => { button("Подписать")!.click(); });
    await flush(); await flush();
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(connection.getLatestBlockhash).toHaveBeenCalled(); // fresh blockhash at signing time
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(result).toEqual({ ok: true, signature: expect.any(String) });
  });

  it("failed simulation: decoded Russian error, signing disabled", async () => {
    simResult = { err: { InstructionError: [1, { Custom: 6013 }] }, logs: ["Program log: AnchorError occurred. Error Code: NotHolder. Error Number: 6013. Error Message: x."], unitsConsumed: 5_000, accounts: [] };
    await act(async () => { void runRef({ title: "Тест", lines: [], ixs: [rx.withdraw(me, 1n)] }); });
    await flush();
    expect(text()).toContain("Эта клетка вам не принадлежит");
    expect(button("Подписать")!.disabled).toBe(true);
  });

  it("refuses instructions of foreign programs (anti-drainer)", async () => {
    const evil = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: new Uint8Array([1]) as unknown as Buffer });
    const r = await runRef({ title: "x", lines: [], ixs: [evil] });
    expect(r.ok).toBe(false);
    expect(connection.simulateTransaction).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ evil: true }));
    expect(text()).not.toContain("Подписать");
  });

  it("refuses dangerous shapes behind allowed programs (composition guard, checklist #104)", async () => {
    const mk = (programId: PublicKey, bytes: number[]) => new TransactionInstruction({ programId, keys: [], data: new Uint8Array(bytes) as unknown as Buffer });
    const cases: [TransactionInstruction, RegExp][] = [
      // System (transfer/assign/create/durable-nonce) is not on the allow-list at all
      [mk(SystemProgram.programId, [2, 0, 0, 0]), /Посторонняя программа/],
      // Token program (approve/setAuthority/transfer) — same
      [mk(TOKEN_PROGRAM_ID, [9]), /Посторонняя программа/],
      // ATA: only create (0) / create_idempotent (1), never recover_nested or anything else
      [mk(ASSOCIATED_TOKEN_PROGRAM_ID, [2]), /разрешены только create/],
      [mk(ASSOCIATED_TOKEN_PROGRAM_ID, []), /разрешены только create/],
      // ORAO: only request_v2 with its exact 8-byte discriminator
      [mk(ORAO_VRF_ID, new Array(32).fill(0)), /только request_v2/],
      // RECURSIA: only discriminators of the known instruction list
      [mk(PROGRAM_ID, [0, 0, 0, 0, 0, 0, 0, 0]), /Неизвестная инструкция RECURSIA/],
      [mk(PROGRAM_ID, [1]), /Неизвестная инструкция RECURSIA/],
    ];
    for (const [ix, re] of cases) {
      expect(refuseIx(ix), re.source).toMatch(re);
      const r = await runRef({ title: "x", lines: [], ixs: [ix] });
      expect(r.ok, re.source).toBe(false);
    }
    expect(connection.simulateTransaction).not.toHaveBeenCalled(); // refused before any RPC work
    expect(signTransaction).not.toHaveBeenCalled();
    // what the app actually builds still passes
    expect(refuseIx(rx.withdraw(me, 1n))).toBeNull();
    expect(refuseIx(mk(ASSOCIATED_TOKEN_PROGRAM_ID, [1]))).toBeNull(); // createAtaIdempotent
    expect(refuseIx(mk(ComputeBudgetProgram.programId, [0, 0, 0, 0]))).toBeNull();
  });

  it("cancel resolves as cancelled, never signs", async () => {
    let result: Result | undefined;
    await act(async () => { runRef({ title: "Тест", lines: [], ixs: [rx.withdraw(me, 1n)] }).then((r) => { result = r; }); });
    await flush();
    await act(async () => { button("Отмена")!.click(); });
    await flush();
    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("confirmed-with-error surfaces the decoded reason", async () => {
    connection.confirmTransaction.mockResolvedValueOnce({ context: { slot: 2 }, value: { err: { InstructionError: [0, { Custom: 6015 }] } as never } });
    let result: Result | undefined;
    await act(async () => { runRef({ title: "Тест", lines: [], ixs: [rx.withdraw(me, 1n)] }).then((r) => { result = r; }); });
    await flush();
    await act(async () => { button("Подписать")!.click(); });
    await flush(); await flush();
    expect(result?.ok).toBe(false);
    expect(text()).toMatch(/фронтраннинга/);
  });
});
