/**
 * Keeper planner — PURE function from an on-chain snapshot to a list of crank
 * actions. No I/O, fully unit-testable. The executor (main.ts) turns actions
 * into transactions, simulates each one and only then signs.
 *
 * Every action here is permissionless on-chain; the program re-validates all
 * conditions, so a stale snapshot can only cause a failed simulation, never a
 * wrong state transition (checklist #17 race conditions, #28 keeper trust).
 */
import type { PublicKey } from "@solana/web3.js";
import {
  BREACH_RESONANCE, harbergerDue,
  type ConfigAccount, type TerritoryAccount, type WorldAccount,
} from "@recursia/sdk";

export interface Snapshot {
  slot: bigint;
  config: ConfigAccount;
  worlds: { key: PublicKey; acc: WorldAccount }[];
  territories: { key: PublicKey; acc: TerritoryAccount }[];
}

export type Action =
  | { kind: "advance_epoch" }
  | { kind: "claim_world_epoch"; world: PublicKey }
  | { kind: "settle"; world: PublicKey; index: number; holder: PublicKey }
  | { kind: "breach"; child: PublicKey; host: PublicKey }
  | { kind: "tick"; world: PublicKey; module: PublicKey; host: PublicKey | null };

export interface PlanLimits {
  /** Max tick transactions per round (each costs a signature fee). */
  maxTicks: number;
  /** Max settle transactions per round. */
  maxSettles: number;
  /** Skip worlds whose energy covers fewer than this many ticks (dust worlds). */
  minTicksOfEnergy: bigint;
}
export const DEFAULT_LIMITS: PlanLimits = { maxTicks: 24, maxSettles: 16, minTicksOfEnergy: 1n };

const isDefault = (k: PublicKey) => k.toBytes().every((b) => b === 0);

/** Can this world's epoch window be claimed right now (mirrors roll_world_epoch + claim checks)? */
export function claimable(w: WorldAccount, curEpoch: bigint): boolean {
  if (w.epochId + 1n === curEpoch) return w.burnCur > 0n; // will roll into prev on-chain
  if (w.epochId === curEpoch) return w.prevEpochId + 1n === curEpoch && !w.prevClaimed && w.burnPrev > 0n;
  return false; // skipped ≥1 epoch: window is forfeited
}

export function plan(s: Snapshot, limits: PlanLimits = DEFAULT_LIMITS): Action[] {
  const out: Action[] = [];
  const c = s.config;
  if (c.paused || !c.genesisDone) return out; // nothing is crankable while paused

  const p = c.params;
  let curEpoch = c.curEpoch;
  if (s.slot >= c.epochStartSlot + p.epochSlots) {
    out.push({ kind: "advance_epoch" });
    curEpoch += 1n; // claims below are ordered after the advance in the same round
  }

  const byKey = new Map(s.worlds.map((w) => [w.key.toBase58(), w]));

  // 1. emission claims (every world, cheap, benefits all holders)
  for (const w of s.worlds) if (claimable(w.acc, curEpoch)) out.push({ kind: "claim_world_epoch", world: w.key });

  // 2. foreclosures — keep the Harberger market honest
  const settles: Action[] = [];
  for (const t of s.territories) {
    const a = t.acc;
    if (isDefault(a.holder)) continue;
    const due = harbergerDue(a.price, p.harbergerBps, s.slot > a.lastTaxSlot ? s.slot - a.lastTaxSlot : 0n, p.epochSlots);
    if (due >= a.deposit) settles.push({ kind: "settle", world: a.world, index: a.index, holder: a.holder });
  }
  out.push(...settles.slice(0, limits.maxSettles));

  // 3. breaches (child life leaking into the host world)
  for (const w of s.worlds) {
    if (w.acc.depth === 0 || w.acc.resonance < BREACH_RESONANCE) continue;
    if (byKey.has(w.acc.parent.toBase58())) out.push({ kind: "breach", child: w.key, host: w.acc.parent });
  }

  // 4. ticks — oldest first so no world starves (fair ordering, DoS resistant)
  const due = s.worlds
    .filter(({ acc }) => {
      if (s.slot < acc.lastTickSlot + p.tickIntervalSlots) return false;
      if (acc.energy < p.tickCost * limits.minTicksOfEnergy) return false;
      if (acc.depth > 0) {
        const host = byKey.get(acc.parent.toBase58());
        if (!host || host.acc.territoryAlive[acc.parentTerritory] === 0) return false; // dormant
      }
      return true;
    })
    .sort((a, b) => (a.acc.lastTickSlot < b.acc.lastTickSlot ? -1 : a.acc.lastTickSlot > b.acc.lastTickSlot ? 1 : 0))
    .slice(0, limits.maxTicks);
  for (const w of due) out.push({ kind: "tick", world: w.key, module: w.acc.module, host: w.acc.depth > 0 ? w.acc.parent : null });

  return out;
}

/** Expected cranker income for a round of ticks, in base units. */
export const crankIncome = (actions: Action[], cfg: ConfigAccount) =>
  BigInt(actions.filter((a) => a.kind === "tick").length) * ((cfg.params.tickCost * BigInt(cfg.params.crankerBps)) / 10_000n);
