/**
 * LiteSVM harness: runs the REAL compiled program (target/deploy/recursia.so)
 * in an in-process Solana VM. Nothing here is mocked except the SKR mint,
 * which is a classic SPL Token mint we create (6 decimals, no freeze authority).
 *
 * The program is deployed through the upgradeable loader with a known upgrade
 * authority, so `initialize` runs its real "only the upgrade authority" check.
 */
import { existsSync, readFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import {
  ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import {
  PROGRAM_ID, Pdas, RecursiaIx, ata, decodeConfig, decodePlayer, decodeSeason, decodeTerritory, decodeTournament, decodeWorld,
  type ConfigAccount,
} from "@recursia/sdk";

const here = dirname(fileURLToPath(import.meta.url));
export const SO_PATH = process.env.RECURSIA_SO ?? resolve(here, "../../../target/deploy/recursia.so");
export const HAVE_SO = existsSync(SO_PATH);
/** CI sets REQUIRE_SO=1 in the job that builds the program: a missing binary is a failure, not a skip. */
export const REQUIRE_SO = process.env.REQUIRE_SO === "1";

export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** Writes a little-endian u64. */
const u64 = (b: Uint8Array, off: number, v: bigint) => new DataView(b.buffer, b.byteOffset).setBigUint64(off, v, true);
const readU64 = (b: Uint8Array, off: number) => new DataView(b.buffer, b.byteOffset).getBigUint64(off, true);

export class ChainError extends Error {
  constructor(readonly code: string, readonly logs: string[]) { super(`${code}\n${logs.slice(-12).join("\n")}`); }
}

/** Anchor error name from the logs ("Error Code: X"), else the runtime error text. */
function errorCode(logs: string[], fallback: string): string {
  for (const l of logs) { const m = /Error Code: (\w+)/.exec(l); if (m) return m[1]; }
  for (const l of logs) if (/already in use/.test(l)) return "AlreadyInUse";
  return fallback;
}

export class Chain {
  readonly svm: LiteSVM;
  readonly upgradeAuthority = Keypair.generate();
  readonly mintAuthority = Keypair.generate();
  readonly mint = Keypair.generate().publicKey;
  readonly rx: RecursiaIx;
  readonly pda: Pdas;
  /** Every SKR token account we know about (for the conservation check). */
  readonly tokenAccounts = new Set<string>();
  supply = 0n;

  constructor(opts: { program?: boolean } = {}) {
    trace("new LiteSVM");
    this.svm = new LiteSVM();
    if (opts.program ?? true) this.deployProgram();
    trace("program deployed");
    this.rx = new RecursiaIx(PROGRAM_ID, this.mint);
    this.pda = this.rx.pda;
    this.writeMint();
    this.svm.airdrop(this.upgradeAuthority.publicKey, 100_000_000_000n);
    for (const k of [this.pda.treasury(), this.pda.rewardPool(), this.pda.claims(), this.pda.sponsorPool(), this.pda.seasonPool(), this.pda.tournamentPool()]) this.tokenAccounts.add(k.toBase58());
  }

  private deployProgram() {
    const so = readFileSync(SO_PATH);
    trace(`loading ${SO_PATH} (${so.length} bytes)`);
    this.svm.addProgramWithLoader(PROGRAM_ID, so, UPGRADEABLE_LOADER);
    trace("addProgramWithLoader ok");
    // Set the upgrade authority in ProgramData: [3u32][slot u64][Some=1][authority]
    const pdKey = PublicKey.findProgramAddressSync([PROGRAM_ID.toBytes()], UPGRADEABLE_LOADER)[0];
    const pd = this.svm.getAccount(pdKey)!;
    const data = Uint8Array.from(pd.data);
    data[12] = 1; data.set(this.upgradeAuthority.publicKey.toBytes(), 13);
    this.svm.setAccount(pdKey, { ...pd, data });
  }

  private writeMint() {
    const d = new Uint8Array(82);
    new DataView(d.buffer).setUint32(0, 1, true); d.set(this.mintAuthority.publicKey.toBytes(), 4);
    u64(d, 36, this.supply); d[44] = 6; d[45] = 1; // decimals, initialized; freeze authority: None (zeros)
    this.svm.setAccount(this.mint, { lamports: Number(this.svm.minimumBalanceForRentExemption(82n)), data: d, owner: TOKEN_PROGRAM, executable: false });
  }

  /** New funded wallet with an SKR token account (ATA) holding `skr` base units. */
  wallet(skr = 0n): Keypair {
    const k = Keypair.generate();
    this.svm.airdrop(k.publicKey, 100_000_000_000n);
    this.setTokenAccount(ata(k.publicKey, this.mint), k.publicKey, skr);
    return k;
  }

  /** Mints `amount` to an arbitrary token account (creating it) and keeps the mint supply in sync. */
  setTokenAccount(address: PublicKey, owner: PublicKey, amount: bigint) {
    const prev = this.tokenBalance(address) ?? 0n;
    const d = new Uint8Array(165);
    d.set(this.mint.toBytes(), 0); d.set(owner.toBytes(), 32); u64(d, 64, amount); d[108] = 1; // state = Initialized
    this.svm.setAccount(address, { lamports: Number(this.svm.minimumBalanceForRentExemption(165n)), data: d, owner: TOKEN_PROGRAM, executable: false });
    this.supply += amount - prev;
    this.writeMint();
    this.tokenAccounts.add(address.toBase58());
  }

  tokenBalance(address: PublicKey): bigint | null {
    const a = this.svm.getAccount(address);
    return a && a.data.length >= 72 ? readU64(a.data, 64) : null;
  }
  skr(owner: PublicKey) { return this.tokenBalance(ata(owner, this.mint)) ?? 0n; }

  get slot() { return this.svm.getClock().slot; }
  /** Advance slots and wall-clock time (≈ 0.4 s per slot). */
  warp(slots: bigint, seconds?: bigint) {
    const c = this.svm.getClock();
    const secs = seconds ?? (slots * 2n) / 5n;
    this.svm.setClock(new Clock(c.slot + slots, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + secs));
  }

  /** Send; throws ChainError with the Anchor error name on failure. */
  send(ixs: TransactionInstruction[], signers: Keypair[]): string[] {
    trace("expire blockhash");
    this.svm.expireBlockhash(); // identical instructions twice must not collide as "already processed"
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    trace(`send ${ixs.map((ix) => ix.programId.equals(PROGRAM_ID) ? Buffer.from(ix.data.subarray(0, 8)).toString("hex") : ix.programId.toBase58().slice(0, 6)).join(",")}`);
    const r = this.svm.sendTransaction(tx);
    trace(r instanceof FailedTransactionMetadata ? `  failed: ${String(r.err())}` : "  ok");
    if (r instanceof FailedTransactionMetadata) {
      const logs = r.meta().logs();
      throw new ChainError(errorCode(logs, String(r.err())), logs);
    }
    return (r as TransactionMetadata).logs();
  }

  /** Expect a failure with the given Anchor error name; the state must be untouched. */
  expectFail(code: string | RegExp, ixs: TransactionInstruction[], signers: Keypair[]) {
    try { this.send(ixs, signers); } catch (e) {
      if (!(e instanceof ChainError)) throw e;
      const ok = typeof code === "string" ? e.code === code : code.test(e.code);
      if (!ok) throw new Error(`expected ${code}, got ${e.code}\n${e.logs.slice(-10).join("\n")}`);
      return e.code;
    }
    throw new Error(`expected failure ${code}, but the transaction succeeded`);
  }

  account<T>(key: PublicKey, decode: (d: Uint8Array) => T): T | null {
    const a = this.svm.getAccount(key);
    return a && a.data.length ? decode(Uint8Array.from(a.data)) : null;
  }
  config(): ConfigAccount { return this.account(this.pda.config(), decodeConfig)!; }
  player(owner: PublicKey) { return this.account(this.pda.player(owner), decodePlayer); }
  world(key: PublicKey) { return this.account(key, decodeWorld)!; }
  territory(world: PublicKey, i: number) { return this.account(this.pda.territory(world, i), decodeTerritory); }
  season() { return this.account(this.pda.season(), decodeSeason)!; }
  tournament(seasonId: bigint, tier: number) { return this.account(this.pda.tournament(seasonId, tier), decodeTournament); }
  bal(k: PublicKey) { return this.tokenBalance(k) ?? 0n; }
}

/** CHAIN_TRACE=1: step trace straight to fd 2 (survives a native abort of the test worker). */
export function trace(msg: string) {
  if (process.env.CHAIN_TRACE) writeSync(2, `chain-trace: ${msg}\n`);
}
