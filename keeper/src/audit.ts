/**
 * Live money invariants of the deployed program — the same ones the LiteSVM
 * tests assert after every step (tests/chain/test/invariants.ts), computed from
 * RPC data. Pure: `watch.ts` fetches, this decides.
 *
 * Money that entered from outside (fund_reward_pool / fund_sponsor_pool) is not
 * stored on-chain, so those two ledgers are checked as monotonicity: the implied
 * external funding  pool − inflows + outflows  may only grow.
 */
import type { PublicKey } from "@solana/web3.js";
import type { ConfigAccount, PlayerAccount, TournamentAccount, WorldAccount } from "@recursia/sdk";

export interface AuditInput {
  config: ConfigAccount;
  /** SPL balances of the program's vaults. */
  bal: { rewardPool: bigint; sponsorPool: bigint; seasonPool: bigint; tournamentPool: bigint; claims: bigint; treasury: bigint };
  worlds: { key: PublicKey; acc: WorldAccount; vault: bigint }[];
  players: PlayerAccount[];
  tournaments: TournamentAccount[];
  /** Current upgrade authority of the program (null = immutable). */
  upgradeAuthority: PublicKey | null;
}

export interface AuditState {
  rewardFundedImplied: bigint;
  sponsorFundedImplied: bigint;
  admin: string;
  paused: boolean;
  pendingNonce: bigint;
  pendingOpen: boolean;
  upgradeAuthority: string | null;
}

export interface AuditResult {
  /** Broken money invariants — page someone, consider `set_pause`. */
  violations: string[];
  /** Governance events worth announcing / double-checking (propose, admin, pause, upgrade authority). */
  notices: string[];
  state: AuditState;
}

const fmt = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function audit(x: AuditInput, prev?: AuditState, nowUnix = BigInt(Math.floor(Date.now() / 1000))): AuditResult {
  const v: string[] = [];
  const n: string[] = [];
  const c = x.config;

  const rewardFundedImplied = x.bal.rewardPool - c.totalSunk + c.totalEmitted;
  const sponsorFundedImplied = x.bal.sponsorPool + c.totalSponsored;
  if (rewardFundedImplied < 0n) v.push(`reward pool below its ledger: pool ${fmt(x.bal.rewardPool)} < sunk − emitted ${fmt(c.totalSunk - c.totalEmitted)}`);
  if (prev && rewardFundedImplied < prev.rewardFundedImplied) v.push(`reward pool lost ${fmt(prev.rewardFundedImplied - rewardFundedImplied)} SKR outside the ledger`);
  if (prev && sponsorFundedImplied < prev.sponsorFundedImplied) v.push(`sponsor pool lost ${fmt(prev.sponsorFundedImplied - sponsorFundedImplied)} SKR outside the ledger`);

  const season = c.totalSeasonFunded - c.totalSeasonPaid;
  if (x.bal.seasonPool !== season) v.push(`season pool ${fmt(x.bal.seasonPool)} ≠ funded − paid ${fmt(season)}`);

  const pots = x.tournaments.reduce((s, t) => s + t.pot, 0n);
  if (x.bal.tournamentPool !== pots) v.push(`tournament pool ${fmt(x.bal.tournamentPool)} ≠ Σ pots ${fmt(pots)}`);

  const owed = x.players.reduce((s, p) => s + p.claimable, 0n);
  if (x.bal.claims < owed) v.push(`claims vault insolvent: ${fmt(x.bal.claims)} < owed ${fmt(owed)}`);

  for (const w of x.worlds) {
    const a = w.acc;
    const need = a.energy + a.rewardsReserved + a.deposits + a.architectAccrued + a.quantumEscrow;
    if (w.vault < need) v.push(`world ${w.key.toBase58()} vault insolvent: ${fmt(w.vault)} < ledger ${fmt(need)}`);
    const pending = a.territoryPending.reduce((s, y) => s + y, 0n);
    if (pending !== a.rewardsReserved) v.push(`world ${w.key.toBase58()}: Σ pending ${fmt(pending)} ≠ reserved ${fmt(a.rewardsReserved)}`);
  }
  if (c.treasurySeen > x.bal.treasury) v.push(`treasury_seen ${fmt(c.treasurySeen)} > treasury ${fmt(x.bal.treasury)}`);

  // governance
  const admin = c.admin.toBase58();
  const upgradeAuthority = x.upgradeAuthority?.toBase58() ?? null;
  if (c.pending.kind !== "None") {
    const eta = c.pendingEta - nowUnix;
    const what = c.pending.kind === "TreasurySpend" ? `TreasurySpend ${fmt(c.pending.amount)} SKR → ${c.pending.recipient.toBase58()}`
      : c.pending.kind === "SetAdmin" ? `SetAdmin → ${c.pending.admin.toBase58()}` : "SetParams";
    if (!prev || prev.pendingNonce !== c.pendingNonce) n.push(`PROPOSAL #${c.pendingNonce}: ${what}; executable in ${eta > 0n ? `${eta / 3600n} h ${(eta % 3600n) / 60n} min` : "now"}`);
  }
  if (prev && prev.pendingOpen && c.pending.kind === "None" && prev.pendingNonce === c.pendingNonce) n.push(`proposal #${c.pendingNonce} executed or cancelled`);
  if (prev && prev.admin !== admin) n.push(`ADMIN CHANGED: ${prev.admin} → ${admin}`);
  if (prev && prev.paused !== c.paused) n.push(c.paused ? "PROGRAM PAUSED" : "program unpaused");
  if (prev && prev.upgradeAuthority !== upgradeAuthority) n.push(`UPGRADE AUTHORITY CHANGED: ${prev.upgradeAuthority ?? "none"} → ${upgradeAuthority ?? "none (immutable)"}`);

  return { violations: v, notices: n, state: { rewardFundedImplied, sponsorFundedImplied, admin, paused: c.paused, pendingNonce: c.pendingNonce, pendingOpen: c.pending.kind !== "None", upgradeAuthority } };
}
