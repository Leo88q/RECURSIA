// Transaction pipeline for live mode (checklist #51 simulate-before-sign,
// #72/#82 no blind signing, #36 slippage caps in the instructions themselves).
//
//   request → simulate (with post-state of your SOL + SKR accounts)
//           → human preview: what, how much, balance deltas, CU, fee, programs
//           → sign with a FRESH blockhash (a preview left open never expires)
//           → rebroadcast until confirmed or the blockhash's last valid height
//           → decoded Russian error or explorer link.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { ASSOCIATED_TOKEN_PROGRAM_ID, ata, explainTxError, ORAO_VRF_ID } from "@recursia/sdk";
import { CONFIG, explorerUrl } from "../lib/config";
import { MINT } from "./mint";
import { formatAmount, lamportsToSol, shortAddr } from "../lib/format";
import { MAX_CU, PHASE_LABEL, PRIORITY_LABEL, computeUnitLimit, estimateFeeLamports, pickPriorityFee, readTokenAmount, type PriorityLevel, type TxPhase } from "../lib/txmath";
import { Modal } from "../ui/Modal";
import { Spinner } from "../ui/fields";
import { useToast } from "../ui/Toast";
import { Glyph } from "../ui/Icon";

export interface TxRequest {
  title: string;
  /** Human-readable consequences, shown before signing. */
  lines: string[];
  ixs: TransactionInstruction[];
  successText?: string;
  /** Extra warning shown in red (irreversible actions). */
  danger?: string;
}
export type TxResult = { ok: true; signature: string } | { ok: false; error: string; cancelled?: boolean };

interface Sim { units?: number; logs: string[]; error?: string; rcrBefore: bigint | null; rcrAfter: bigint | null; solBefore: number; solAfter: number | null; feeSamples: number[] }
interface State { req: TxRequest; phase: TxPhase; sim?: Sim; signature?: string; error?: string }

const PROGRAM_ID = new PublicKey(CONFIG.programId);
const ALLOWED_PROGRAMS = new Map<string, string>([
  [PROGRAM_ID.toBase58(), "RECURSIA"],
  [ComputeBudgetProgram.programId.toBase58(), "Compute Budget"],
  [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), "Associated Token"],
  [SystemProgram.programId.toBase58(), "System"],
  [ORAO_VRF_ID.toBase58(), "ORAO VRF (оракул случайности)"],
]);

const TxCtx = createContext<((r: TxRequest) => Promise<TxResult>) | null>(null);
export function useTx() {
  const c = useContext(TxCtx);
  if (!c) throw new Error("useTx outside TxProvider");
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TxProvider({ children, onConfirmed }: { children: ReactNode; onConfirmed?: () => void }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();
  const [st, setSt] = useState<State | null>(null);
  const [level, setLevel] = useState<PriorityLevel>(() => (localStorage.getItem("recursia:priority") as PriorityLevel) || "normal");
  const resolver = useRef<((r: TxResult) => void) | null>(null);
  const mint = MINT;

  const finish = useCallback((r: TxResult) => { resolver.current?.(r); resolver.current = null; }, []);

  const simulate = useCallback(async (req: TxRequest, payer: PublicKey): Promise<Sim> => {
    const userAta = ata(payer, mint);
    const [pre, bh] = await Promise.all([connection.getMultipleAccountsInfo([payer, userAta], "confirmed"), connection.getLatestBlockhash("confirmed")]);
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: bh.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }), ...req.ixs] }).compileToV0Message();
    const writable = [...new Set(req.ixs.flatMap((ix) => ix.keys.filter((k) => k.isWritable && !k.isSigner).map((k) => k.pubkey.toBase58())))].slice(0, 64).map((k) => new PublicKey(k));
    const [sim, fees] = await Promise.all([
      connection.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { addresses: [payer.toBase58(), userAta.toBase58()], encoding: "base64" } }),
      connection.getRecentPrioritizationFees({ lockedWritableAccounts: writable }).catch(() => []),
    ]);
    const post = sim.value.accounts ?? [];
    const postData = (i: number) => { const a = post[i]; return a ? Uint8Array.from(atob((a.data as unknown as [string, string])[0]), (c) => c.charCodeAt(0)) : null; };
    const logs = sim.value.logs ?? [];
    return {
      units: sim.value.unitsConsumed, logs,
      error: sim.value.err ? explainTxError(sim.value.err, logs) : undefined,
      rcrBefore: readTokenAmount(pre[1]?.data), rcrAfter: post[1] ? readTokenAmount(postData(1)) : null,
      solBefore: pre[0]?.lamports ?? 0, solAfter: post[0]?.lamports ?? null,
      feeSamples: fees.map((f) => f.prioritizationFee),
    };
  }, [connection, mint]);

  const run = useCallback((req: TxRequest): Promise<TxResult> => {
    if (!wallet.publicKey) { toast.push({ kind: "bad", title: "Подключите кошелёк" }); return Promise.resolve({ ok: false, error: "no wallet", cancelled: true }); }
    const foreign = req.ixs.find((ix) => !ALLOWED_PROGRAMS.has(ix.programId.toBase58()));
    if (foreign) return Promise.resolve({ ok: false, error: `Посторонняя программа ${foreign.programId.toBase58()} — отказ` });
    resolver.current?.({ ok: false, error: "заменено новой транзакцией", cancelled: true });
    const payer = wallet.publicKey;
    setSt({ req, phase: "simulating" });
    simulate(req, payer)
      .then((sim) => setSt((s) => (s && s.req === req ? { ...s, phase: "preview", sim } : s)))
      .catch((e) => setSt((s) => (s && s.req === req ? { ...s, phase: "preview", sim: { logs: [], error: explainTxError(e), rcrBefore: null, rcrAfter: null, solBefore: 0, solAfter: null, feeSamples: [] } } : s)));
    return new Promise<TxResult>((res) => { resolver.current = res; });
  }, [wallet.publicKey, simulate, toast]);

  const cancel = () => { finish({ ok: false, error: "отменено", cancelled: true }); setSt(null); };

  const sign = async () => {
    if (!st?.sim || !wallet.publicKey) return;
    const req = st.req;
    const payer = wallet.publicKey;
    const cu = computeUnitLimit(st.sim.units);
    const price = pickPriorityFee(st.sim.feeSamples, level, CONFIG.maxPriorityFee);
    localStorage.setItem("recursia:priority", level);
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...(price > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })] : []), ...req.ixs];
    try {
      setSt((s) => s && { ...s, phase: "signing" });
      const bh = await connection.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message());
      let signature: string;
      let raw: Uint8Array | null = null;
      if (wallet.signTransaction) {
        const signed = await wallet.signTransaction(tx);
        raw = signed.serialize();
        signature = bs58.encode(signed.signatures[0]);
        setSt((s) => s && { ...s, phase: "sending", signature });
        await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      } else {
        signature = await wallet.sendTransaction(tx, connection, { maxRetries: 5 });
      }
      setSt((s) => s && { ...s, phase: "confirming", signature });
      // Rebroadcast until confirmed or the blockhash expires (no double-spend risk: same signature).
      let done = false;
      const rebroadcast = (async () => {
        while (!done && raw) { await sleep(2500); if (!done) connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); }
      })();
      const conf = await connection.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed").finally(() => { done = true; });
      void rebroadcast;
      if (conf.value.err) {
        const info = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
        throw Object.assign(new Error(explainTxError(conf.value.err, info?.meta?.logMessages ?? [])), { explained: true });
      }
      setSt((s) => s && { ...s, phase: "confirmed", signature });
      toast.push({ kind: "ok", title: req.successText ?? `${req.title}: подтверждено`, href: explorerUrl("tx", signature) });
      finish({ ok: true, signature });
      onConfirmed?.();
      setTimeout(() => setSt((s) => (s?.signature === signature ? null : s)), 900);
    } catch (e) {
      const error = (e as { explained?: boolean }).explained ? (e as Error).message : explainTxError(e);
      const cancelled = /отклонили/.test(error);
      setSt((s) => s && { ...s, phase: cancelled ? "preview" : "failed", error: cancelled ? undefined : error });
      if (cancelled) toast.push({ kind: "info", title: "Подпись отклонена" });
      else { toast.push({ kind: "bad", title: `${req.title}: не выполнено`, body: error }); finish({ ok: false, error }); }
    }
  };

  const programs = st ? [...new Set(st.req.ixs.map((ix) => ix.programId.toBase58()))] : [];
  const sim = st?.sim;
  const cu = computeUnitLimit(sim?.units);
  const price = sim ? pickPriorityFee(sim.feeSamples, level, CONFIG.maxPriorityFee) : 0;
  const busy = st?.phase === "signing" || st?.phase === "sending" || st?.phase === "confirming";

  return (
    <TxCtx.Provider value={run}>
      {children}
      {st && (
        <Modal title={st.req.title} onClose={cancel} locked={busy} className="tx-modal">
          <ul className="tx-lines">{st.req.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {st.req.danger && <div className="sim bad">{st.req.danger}</div>}
          {st.phase === "simulating" && <div className="sim"><Spinner /> Симуляция транзакции в сети…</div>}
          {sim && (
            <>
              <div className={sim.error ? "sim bad" : "sim ok"} role="status">
                {sim.error ? <>Симуляция не прошла: <b>{sim.error}</b></> : <>Симуляция успешна · {sim.units?.toLocaleString("ru-RU") ?? "?"} CU</>}
              </div>
              {!sim.error && (
                <dl className="kv tx-kv">
                  {sim.rcrBefore !== null || sim.rcrAfter !== null ? (<><dt>SKR на кошельке</dt><dd>{formatAmount(sim.rcrBefore ?? 0n)} → <b>{formatAmount(sim.rcrAfter ?? sim.rcrBefore ?? 0n)}</b>{delta(sim.rcrBefore ?? 0n, sim.rcrAfter ?? sim.rcrBefore ?? 0n)}</dd></>) : null}
                  {sim.solAfter !== null && <><dt>SOL (рента аккаунтов)</dt><dd>{lamportsToSol(sim.solBefore)} → {lamportsToSol(sim.solAfter)}</dd></>}
                  <dt>Комиссия сети</dt><dd>≈ {lamportsToSol(estimateFeeLamports(cu, price))} SOL</dd>
                </dl>
              )}
              {!sim.error && (
                <div className="row-wrap" role="radiogroup" aria-label="Приоритет">
                  <span className="muted small">Приоритет:</span>
                  {(Object.keys(PRIORITY_LABEL) as PriorityLevel[]).map((l) => (
                    <button key={l} role="radio" aria-checked={level === l} className={level === l ? "chip on" : "chip"} disabled={busy} onClick={() => setLevel(l)}>{PRIORITY_LABEL[l]}</button>
                  ))}
                  <span className="muted small">{price.toLocaleString("ru-RU")} µL/CU (потолок {CONFIG.maxPriorityFee.toLocaleString("ru-RU")})</span>
                </div>
              )}
              <details>
                <summary>Программы ({programs.length}) и логи</summary>
                <ul className="small">{programs.map((p) => <li key={p}>{ALLOWED_PROGRAMS.get(p)} · <code>{shortAddr(p, 6)}</code></li>)}</ul>
                <pre>{sim.logs.join("\n") || "—"}</pre>
              </details>
            </>
          )}
          <p className="muted small">Сверьте адрес программы: <code>{CONFIG.programId}</code>. RECURSIA никогда не просит seed-фразу и не подписывает за вас.</p>
          {st.error && <div className="sim bad" role="alert">{st.error}</div>}
          {st.signature && <a className="small" href={explorerUrl("tx", st.signature)} target="_blank" rel="noopener noreferrer">Транзакция {shortAddr(st.signature, 8)} <Glyph name="external" size={12} /></a>}
          <div className="row-wrap modal-actions">
            {st.phase === "failed" || st.phase === "confirmed"
              ? <button className="btn" onClick={() => setSt(null)}>Закрыть</button>
              : <button className="btn" onClick={cancel} disabled={busy}>Отмена</button>}
            {st.phase === "failed" && <button className="btn primary" onClick={() => { const r = st.req; setSt(null); const prev = resolver.current; resolver.current = null; run(r).then((x) => prev?.(x)); }}>Повторить</button>}
            {(st.phase === "preview" || busy) && (
              <button className="btn primary" data-autofocus disabled={!sim || !!sim.error || busy} onClick={sign}>
                {busy ? <><Spinner label={PHASE_LABEL[st.phase]} /> {PHASE_LABEL[st.phase]}</> : "Подписать"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </TxCtx.Provider>
  );
}

function delta(a: bigint, b: bigint) {
  const d = b - a;
  if (d === 0n) return null;
  return <span className={d < 0n ? "neg" : "pos"}> ({d > 0n ? "+" : ""}{formatAmount(d)})</span>;
}
