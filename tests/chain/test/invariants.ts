/** On-chain money invariants of the deployed program (shared by the lifecycle test and the fuzzer). */
import { expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TERRITORIES, TOURNAMENT_TIERS, decodeSuperposition, decodeSwap } from "@recursia/sdk";
import type { Chain } from "./harness.js";

export type Ledger = {
  /** everything paid into the reward pool from outside the game (fund_reward_pool) */
  rewardFunded: bigint;
  players: PublicKey[];
  worlds: PublicKey[];
  /** open swap PDAs' (world, a, b) — needed for the exact quantum-escrow check */
  swaps?: { world: PublicKey; a: number; b: number }[];
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
    // EXACT sub-ledgers (not just ≥): tax deposits and quantum escrow are fully attributed
    let deposits = 0n, escrow = 0n;
    for (let i = 0; i < TERRITORIES; i++) {
      const t = c.territory(w, i);
      if (t && !t.holder.equals(PublicKey.default)) deposits += t.deposit;
      const sp = c.account(c.pda.superposition(w, i), decodeSuperposition);
      if (sp) escrow += sp.stake;
    }
    for (const s of l.swaps ?? []) {
      if (!s.world.equals(w)) continue;
      const sw = c.account(c.pda.swap(w, s.a, s.b), decodeSwap);
      if (sw) escrow += sw.premium + sw.bounty;
    }
    expect(deposits, `${step}: world.deposits == Σ territory deposits`).toBe(a.deposits);
    if (l.swaps) expect(escrow, `${step}: quantum escrow == Σ stakes + Σ swap escrow`).toBe(a.quantumEscrow);
    // reserved rewards == Σ pending of its territories
    const pending = a.territoryPending.reduce((x, y) => x + y, 0n);
    expect(pending, `${step}: Σ territory pending == rewards reserved`).toBe(a.rewardsReserved);
  }
  // treasury: the governance-spendable part never exceeds the balance
  expect(cfg.treasurySeen <= c.bal(c.pda.treasury()), `${step}: treasury_seen ≤ treasury`).toBe(true);
}
