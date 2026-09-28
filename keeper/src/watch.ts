/**
 * RECURSIA watcher: read-only monitoring of a deployed program.
 *
 *   RPC_URL=https://… PROGRAM_ID=… MINT=… [ALERT_WEBHOOK=https://…] npm run watch -w @recursia/keeper [-- --once]
 *
 * Every INTERVAL_MS (default 60 s) it recomputes the money invariants
 * (`audit.ts`) and watches governance (proposals, admin, pause, upgrade
 * authority). Violations and notices go to stdout/stderr and, if set, as JSON
 * `{ level, text }` POSTed to ALERT_WEBHOOK (Discord/Slack/Telegram bridge).
 * It holds no keys and sends no transactions. Exit code 1 on violations with --once (for cron / CI).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  PROGRAM_ID, RecursiaIx, SKR_MINT, accountDiscriminator, decodeConfig, decodePlayer, decodeTournament, decodeWorld,
} from "@recursia/sdk";
import { audit, type AuditInput, type AuditState } from "./audit.js";

const once = process.argv.includes("--once");
const env = (k: string, d?: string) => { const v = process.env[k] ?? d; if (v === undefined) { console.error(`missing env ${k}`); process.exit(2); } return v; };
const RPC_URL = env("RPC_URL");
if (!/^https:\/\//.test(RPC_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC_URL)) { console.error("RPC_URL must be https (or localhost)"); process.exit(2); }
const WEBHOOK = process.env.ALERT_WEBHOOK;
if (WEBHOOK && !/^https:\/\//.test(WEBHOOK)) { console.error("ALERT_WEBHOOK must be https"); process.exit(2); }
const programId = new PublicKey(env("PROGRAM_ID", PROGRAM_ID.toBase58()));
const mint = new PublicKey(env("MINT", SKR_MINT.toBase58()));
const INTERVAL = Number(env("INTERVAL_MS", "60000"));
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const conn = new Connection(RPC_URL, "confirmed");
const rx = new RecursiaIx(programId, mint);
const disc = (name: string) => ({ memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator(name)) } });
const amount = (d: Buffer | null | undefined) => (d && d.length >= 72 ? d.readBigUInt64LE(64) : 0n);

async function fetchInput(): Promise<AuditInput> {
  const p = rx.pda;
  const [cfgInfo, worlds, players, tours, vaults, programInfo] = await Promise.all([
    conn.getAccountInfo(p.config()),
    conn.getProgramAccounts(programId, { filters: [disc("World")] }),
    conn.getProgramAccounts(programId, { filters: [disc("Player")] }),
    conn.getProgramAccounts(programId, { filters: [disc("Tournament")] }),
    conn.getMultipleAccountsInfo([p.rewardPool(), p.sponsorPool(), p.seasonPool(), p.tournamentPool(), p.claims(), p.treasury()]),
    conn.getAccountInfo(programId),
  ]);
  if (!cfgInfo || !cfgInfo.owner.equals(programId)) throw new Error("config account missing");
  const worldVaults = await conn.getMultipleAccountsInfo(worlds.map((w) => p.worldVault(w.pubkey)));
  // upgradeable program: [2u32][programdata]; programdata: [3u32][slot u64][Option<authority>]
  let upgradeAuthority: PublicKey | null = null;
  if (programInfo && programInfo.owner.equals(UPGRADEABLE_LOADER) && programInfo.data.length >= 36) {
    const pd = await conn.getAccountInfo(new PublicKey(programInfo.data.subarray(4, 36)));
    if (pd && pd.data[12] === 1) upgradeAuthority = new PublicKey(pd.data.subarray(13, 45));
  }
  const [rewardPool, sponsorPool, seasonPool, tournamentPool, claims, treasury] = vaults.map((a) => amount(a?.data));
  return {
    config: decodeConfig(cfgInfo.data),
    bal: { rewardPool, sponsorPool, seasonPool, tournamentPool, claims, treasury },
    worlds: worlds.map((w, i) => ({ key: w.pubkey, acc: decodeWorld(w.account.data), vault: amount(worldVaults[i]?.data) })),
    players: players.map((a) => decodePlayer(a.account.data)),
    tournaments: tours.map((a) => decodeTournament(a.account.data)),
    upgradeAuthority,
  };
}

async function alert(level: "violation" | "notice", text: string) {
  (level === "violation" ? console.error : console.log)(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${text}`);
  if (!WEBHOOK) return;
  try { await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level, text, content: `RECURSIA ${level}: ${text}` }) }); }
  catch (e) { console.error("webhook failed:", (e as Error).message); }
}

let prev: AuditState | undefined;
async function round(): Promise<number> {
  const r = audit(await fetchInput(), prev);
  for (const t of r.violations) await alert("violation", t);
  for (const t of r.notices) await alert("notice", t);
  if (!prev) console.log(`watching ${programId.toBase58()}: admin ${r.state.admin}, upgrade authority ${r.state.upgradeAuthority ?? "none"}, paused ${r.state.paused}`);
  prev = r.state;
  return r.violations.length;
}

if (once) process.exit((await round()) > 0 ? 1 : 0);
for (;;) {
  try { await round(); } catch (e) { console.error(`[${new Date().toISOString()}] round failed:`, (e as Error).message); }
  await new Promise((res) => setTimeout(res, INTERVAL));
}
