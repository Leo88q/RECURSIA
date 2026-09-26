/**
 * RECURSIA keeper — permissionless crank bot.
 *
 * Earns the cranker share of every tick it lands and keeps the world moving:
 * epochs, emission claims, Harberger foreclosures, breaches, ticks.
 *
 * Env:
 *   RPC_URL                 https RPC endpoint (required)
 *   KEEPER_KEYPAIR          path to a JSON keypair file (required, chmod 600)
 *   PROGRAM_ID              optional override of the program id
 *   INTERVAL_MS             round interval, default 4000
 *   MAX_PRIORITY_MICROLAMPORTS  priority-fee cap per CU, default 5000
 *   MIN_SOL                 stop when balance falls below, default 0.05
 * Flags: --once (single round), --dry-run (simulate only, never send)
 *
 * Security notes (checklist #38 key leakage, #64 auto-approve, #72 limits in code):
 *  - the secret key is read from a file, never from argv/env text, never logged;
 *  - every transaction is simulated before signing; failures are skipped;
 *  - the keeper only ever signs instructions it built itself from the SDK and
 *    only for PROGRAM_ID + ComputeBudget + ATA program (allow-list below);
 *  - hard caps: txs per round, priority fee, SOL floor.
 */
import { readFileSync, statSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, PROGRAM_ID, RecursiaIx, accountDiscriminator,
  decodeConfig, decodeTerritory, decodeWorld,
} from "@recursia/sdk";
import { DEFAULT_LIMITS, crankIncome, plan, type Snapshot } from "./plan.js";
import { toInstruction } from "./ix.js";

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const DRY = args.has("--dry-run");
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) { console.error(`missing env ${k}`); process.exit(2); }
  return v;
};

const RPC_URL = env("RPC_URL");
if (!/^https:\/\//.test(RPC_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC_URL)) {
  console.error("RPC_URL must be https (or localhost)"); process.exit(2);
}
const programId = new PublicKey(env("PROGRAM_ID", PROGRAM_ID.toBase58()));
const INTERVAL = Number(env("INTERVAL_MS", "4000"));
const MAX_PRIO = Number(env("MAX_PRIORITY_MICROLAMPORTS", "5000"));
const MIN_LAMPORTS = Math.round(Number(env("MIN_SOL", "0.05")) * 1e9);

function loadKeypair(path: string): Keypair {
  const st = statSync(path);
  if ((st.mode & 0o077) !== 0) console.warn(`⚠ ${path} is readable by group/others — chmod 600 it`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error("keypair file must be a 64-byte JSON array");
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const ALLOWED_PROGRAMS = new Set([programId.toBase58(), ComputeBudgetProgram.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]);

async function snapshot(conn: Connection, rx: RecursiaIx): Promise<Snapshot> {
  const disc = (n: string) => ({ memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator(n)) } });
  const [cfgInfo, worlds, territories, slot] = await Promise.all([
    conn.getAccountInfo(rx.pda.config(), "confirmed"),
    conn.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("World")] }),
    conn.getProgramAccounts(programId, { commitment: "confirmed", filters: [disc("Territory")] }),
    conn.getSlot("confirmed"),
  ]);
  if (!cfgInfo || !cfgInfo.owner.equals(programId)) throw new Error("config account missing or not owned by program");
  const safe = <T>(f: () => T) => { try { return f(); } catch { return null; } };
  return {
    slot: BigInt(slot),
    config: decodeConfig(cfgInfo.data),
    worlds: worlds.flatMap(({ pubkey, account }) => { const acc = safe(() => decodeWorld(account.data)); return acc ? [{ key: pubkey, acc }] : []; }),
    territories: territories.flatMap(({ pubkey, account }) => { const acc = safe(() => decodeTerritory(account.data)); return acc ? [{ key: pubkey, acc }] : []; }),
  };
}

async function priorityFee(conn: Connection): Promise<number> {
  try {
    const fees = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: [programId] });
    const vals = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    const p75 = vals.length ? vals[Math.floor(vals.length * 0.75)] : 0;
    return Math.min(p75, MAX_PRIO);
  } catch { return 0; }
}

async function send(conn: Connection, payer: Keypair, ixs: TransactionInstruction[], label: string, prio: number): Promise<boolean> {
  for (const ix of ixs) if (!ALLOWED_PROGRAMS.has(ix.programId.toBase58())) throw new Error(`refusing to sign foreign program ${ix.programId.toBase58()}`);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...(prio > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prio })] : []),
    ...ixs,
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash; tx.feePayer = payer.publicKey;
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    const why = sim.value.logs?.find((l) => l.includes("Error Message")) ?? JSON.stringify(sim.value.err);
    console.log(`  · skip ${label}: ${why}`);
    return false;
  }
  if (DRY) { console.log(`  · dry-run ok ${label} (${sim.value.unitsConsumed} CU)`); return true; }
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) { console.log(`  ✗ ${label} ${sig}`); return false; }
  console.log(`  ✓ ${label} ${sig}`);
  return true;
}

async function main() {
  const payer = loadKeypair(env("KEEPER_KEYPAIR"));
  const conn = new Connection(RPC_URL, "confirmed");
  const rx = new RecursiaIx(programId);
  const prog = await conn.getAccountInfo(programId);
  if (!prog?.executable) throw new Error(`program ${programId.toBase58()} not deployed on this cluster`);

  // single-instance lock: two keepers with one key would just race each other's fees
  const lock = `/tmp/recursia-keeper-${payer.publicKey.toBase58().slice(0, 8)}.lock`;
  if (existsSync(lock)) throw new Error(`another keeper holds ${lock}`);
  closeSync(openSync(lock, "wx"));
  const release = () => { try { unlinkSync(lock); } catch { /* */ } };
  let stop = false;
  process.on("SIGINT", () => { stop = true; }); process.on("SIGTERM", () => { stop = true; });
  process.on("exit", release);

  console.log(`keeper ${payer.publicKey.toBase58()} → ${programId.toBase58()}${DRY ? " (dry-run)" : ""}`);
  await send(conn, payer, [rx.createAtaIdempotent(payer.publicKey, payer.publicKey)], "ensure cranker ATA", 0);

  let backoff = INTERVAL;
  while (!stop) {
    try {
      const bal = await conn.getBalance(payer.publicKey);
      if (bal < MIN_LAMPORTS) { console.error(`balance ${bal / 1e9} SOL below floor — stopping`); break; }
      const snap = await snapshot(conn, rx);
      const actions = plan(snap, DEFAULT_LIMITS);
      if (actions.length) {
        console.log(`slot ${snap.slot}: ${actions.length} action(s), expected crank income ${crankIncome(actions, snap.config)}`);
        const prio = await priorityFee(conn);
        for (const a of actions) {
          if (stop) break;
          const label = a.kind + ("world" in a ? ` ${a.world.toBase58().slice(0, 6)}` : "") + ("index" in a ? `#${a.index}` : "");
          try { await send(conn, payer, [toInstruction(rx, payer.publicKey, a)], label, prio); }
          catch (e) { console.log(`  ✗ ${label}: ${(e as Error).message}`); }
        }
      }
      backoff = INTERVAL;
    } catch (e) {
      backoff = Math.min(backoff * 2, 60_000);
      console.error(`round failed: ${(e as Error).message}; retry in ${backoff}ms`);
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, backoff));
  }
  release();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
