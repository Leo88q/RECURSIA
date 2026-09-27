/** On-chain money invariants of the deployed program (shared by the lifecycle test and the fuzzer). */
import { expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TOURNAMENT_TIERS } from "@recursia/sdk";
import type { Chain } from "./harness.js";

export type Ledger = {
  /** everything paid into the reward pool from outside the game (fund_reward_pool) */
  rewardFunded: bigint;
  players: PublicKey[];
  worlds: PublicKey[];
};

export function checkInvariants(c: Chain, l: Ledger, step: string) {
  const cfg = c.config();
  // I1 conservation: every SKR base unit is in a known token account
  let sum = 0n; for (const k of c.tokenAccounts) sum += c.tokenBalance(new PublicKey(k)) ?? 0n;
  expect(sum, `${step}: Σ balances == supply`).toBe(c.supply);
  // reward pool ledger: only external funding + recorded pool inflows − emission
  expect(c.bal(c.pda.rewardPool()), `${step}: reward pool ledger`).toBe(l.rewardFunded + cfg.totalSunk - cfg.totalEmitted);
  // season pool ledger
  expect(c.bal(c.pda.seasonPool()), `${step}: season pool ledger`).toBe(cfg.totalSeasonFunded - cfg.totalSeasonPaid);
  // sponsor pool: never funded in these tests
  expect(c.bal(c.pda.sponsorPool()) + cfg.totalSponsored, `${step}: sponsor ledger`).toBe(0n);
  // tournament pool == Σ open pots
  let pots = 0n;
  for (let s = 1n; s <= cfg.seasonId; s++) for (let t = 0; t < TOURNAMENT_TIERS.length; t++) pots += c.tournament(s, t)?.pot ?? 0n;
  expect(c.bal(c.pda.tournamentPool()), `${step}: tournament pool == Σ pots`).toBe(pots);
  // claims vault solvency: it can pay every player's balance
  let owed = 0n; for (const p of l.players) owed += c.player(p)?.claimable ?? 0n;
  expect(c.bal(c.pda.claims()) >= owed, `${step}: claims vault solvent (${c.bal(c.pda.claims())} < ${owed})`).toBe(true);
  // world vault solvency: every sub-ledger is backed (same formula as world_ledger_total)
  for (const w of l.worlds) {
    const a = c.world(w);
    const need = a.energy + a.rewardsReserved + a.deposits + a.architectAccrued + a.quantumEscrow;
    expect(c.bal(c.pda.worldVault(w)) >= need, `${step}: world vault solvent (${c.bal(c.pda.worldVault(w))} < ${need})`).toBe(true);
    // reserved rewards == Σ pending of its territories
    const pending = a.territoryPending.reduce((x, y) => x + y, 0n);
    expect(pending, `${step}: Σ territory pending == rewards reserved`).toBe(a.rewardsReserved);
  }
  // treasury: the governance-spendable part never exceeds the balance
  expect(cfg.treasurySeen <= c.bal(c.pda.treasury()), `${step}: treasury_seen ≤ treasury`).toBe(true);
}
