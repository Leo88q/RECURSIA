/**
 * Stateful fuzzing of the money instructions on the COMPILED program (checklist #54).
 *
 * A seeded random walk over acquire / buy-out / set_price / top_up / withdraw_deposit /
 * plant / collect / withdraw / fund_world / tick / settle (foreclosure) / epochs /
 * tournaments, by honest players AND by wallets acting on territories they don't own,
 * with random (often invalid) prices, deposits and amounts.
 *
 * After EVERY step all money invariants must hold. Rejections are expected (that's the
 * point), but a rejection of the "bug" class is a failure: a panic, an arithmetic
 * overflow, the program's own InvariantViolated guard, or running out of compute.
 *
 * FUZZ_SEED / FUZZ_STEPS env vars reproduce or extend a run.
 */
import { describe, expect, it } from "vitest";
import { PublicKey, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { DEFAULT_PARAMS, ONE, PHYSICS_PRESETS, epochTax } from "@recursia/sdk";
import { Chain, ChainError, HAVE_SO, trace } from "./harness.js";
import { checkInvariants, type Ledger } from "./invariants.js";

const P = DEFAULT_PARAMS;
const SEED = Number(process.env.FUZZ_SEED ?? 20260927);
const STEPS = Number(process.env.FUZZ_STEPS ?? 400);
const BUG = /ProgramFailedToComplete|panicked|InvariantViolated|MathOverflow|ArithmeticOverflow|AccessViolation|ComputationalBudgetExceeded|exceeded CUs/;
const PATTERNS = [0x0000_0018_1800_0000n, 0x0000_1824_2418_0000n, 0x0000_0000_0e00_0000n, 0xffff_ffff_ffff_ffffn, 0n, 0x0102_0408_1020_4080n];
const run = HAVE_SO ? describe : describe.skip;

function rng(seed: number) {
  let s = BigInt(seed) || 1n;
  const next = () => { s ^= (s << 13n) & 0xffff_ffff_ffff_ffffn; s ^= s >> 7n; s ^= (s << 17n) & 0xffff_ffff_ffff_ffffn; return s; };
  return {
    int: (n: number) => Number(next() % BigInt(n)),
    big: (n: bigint) => (n <= 0n ? 0n : next() % n),
    pick: <T>(a: readonly T[]) => a[Number(next() % BigInt(a.length))],
    chance: (p: number) => Number(next() % 10_000n) < p * 10_000,
  };
}

run(`stateful fuzz of money instructions (seed ${SEED}, ${STEPS} steps)`, () => {
  it("no step breaks an invariant or hits a bug-class error", () => {
    const r = rng(SEED);
    const c = new Chain();
    const admin = c.wallet(5_000_000n * ONE);
    const users = Array.from({ length: 5 }, () => c.wallet(200_000n * ONE));
    const keeper = c.wallet(0n);
    const all = [admin, ...users, keeper];
    const l: Ledger = { rewardFunded: 0n, players: all.map((k) => k.publicKey), worlds: [] };

    c.send([c.rx.initialize(c.upgradeAuthority.publicKey, admin.publicKey, P)], [c.upgradeAuthority]);
    c.send([c.rx.fundRewardPool(admin.publicKey, 500_000n * ONE)], [admin]); l.rewardFunded += 500_000n * ONE;
    const law = PHYSICS_PRESETS[0];
    c.send([c.rx.registerModule(admin.publicKey, 0n, law.birth, law.survive, law.royaltyBps, law.name)], [admin]);
    const module = c.pda.module(0n);
    for (const [k, name] of [[users[0], "Alpha"], [users[1], "Beta"]] as const) {
      const w = c.rx.createRootWorld(k.publicKey, c.config().rootWorlds, module, 500 + r.int(2_500), name, 50_000n * ONE);
      c.send([w.ix], [k]);
      l.worlds.push(w.world); c.tokenAccounts.add(c.pda.worldVault(w.world).toBase58());
    }
    checkInvariants(c, l, "setup");

    const stats = new Map<string, { ok: number; rejected: number }>();
    const holderOf = (w: PublicKey, i: number) => {
      const t = c.territory(w, i);
      return t && !t.holder.equals(PublicKey.default) ? t : null;
    };
    const signerFor = (w: PublicKey, i: number): Keypair => {
      const t = holderOf(w, i);
      // 75%: the real holder (if any); otherwise a random wallet — an unauthorized attempt
      if (t && r.chance(0.75)) return all.find((k) => k.publicKey.equals(t.holder)) ?? r.pick(users);
      return r.pick(users);
    };

    type Action = [name: string, weight: number, build: () => { ixs: TransactionInstruction[]; signers: Keypair[] } | null];
    const actions: Action[] = [
      ["acquire", 5, () => {
        const w = r.pick(l.worlds), i = r.int(16), buyer = r.pick(users);
        const t = holderOf(w, i);
        const current = t ? t.price : P.minPrice;
        const maxPrice = r.chance(0.1) ? current - 1n : current + r.big(current);
        const newPrice = r.chance(0.1) ? P.minPrice - 1n : P.minPrice + r.big(P.minPrice * 20n);
        const deposit = epochTax(newPrice > 0n ? newPrice : 1n, P.harbergerBps) * r.big(6n);
        const claimed = r.chance(0.1) ? r.pick(users).publicKey : t?.holder ?? null; // stale / wrong holder
        return { ixs: [c.rx.acquire(buyer.publicKey, w, i, claimed, maxPrice, newPrice, deposit)], signers: [buyer] };
      }],
      ["set_price", 2, () => {
        const w = r.pick(l.worlds), i = r.int(16), k = signerFor(w, i);
        return { ixs: [c.rx.setPrice(k.publicKey, w, i, r.chance(0.1) ? 0n : P.minPrice + r.big(P.minPrice * 30n))], signers: [k] };
      }],
      ["top_up", 2, () => {
        const w = r.pick(l.worlds), i = r.int(16), k = signerFor(w, i);
        return { ixs: [c.rx.topUp(k.publicKey, w, i, r.big(20_000n * ONE))], signers: [k] };
      }],
      ["withdraw_deposit", 2, () => {
        const w = r.pick(l.worlds), i = r.int(16), k = signerFor(w, i);
        const t = holderOf(w, i);
        return { ixs: [c.rx.withdrawDeposit(k.publicKey, w, i, r.big((t?.deposit ?? 1_000n * ONE) + 2n))], signers: [k] };
      }],
      ["plant", 4, () => {
        const w = r.pick(l.worlds), i = r.int(16), k = signerFor(w, i);
        return { ixs: [c.rx.plant(k.publicKey, w, i, r.pick(PATTERNS))], signers: [k] };
      }],
      ["collect", 3, () => {
        const w = r.pick(l.worlds), i = r.int(16), k = signerFor(w, i);
        return { ixs: [c.rx.collect(k.publicKey, w, i)], signers: [k] };
      }],
      ["withdraw", 2, () => {
        const k = r.pick(all);
        const owed = c.player(k.publicKey)?.claimable ?? 0n;
        return { ixs: [c.rx.withdraw(k.publicKey, r.chance(0.2) ? owed + 1n + r.big(ONE) : r.big(owed + 1n))], signers: [k] };
      }],
      ["fund_world", 1, () => {
        const k = r.pick(users);
        return { ixs: [c.rx.fundWorld(k.publicKey, r.pick(l.worlds), r.big(30_000n * ONE))], signers: [k] };
      }],
      ["tick", 6, () => {
        c.warp(BigInt(P.tickIntervalSlots) - 5n + r.big(20n));
        return { ixs: [c.rx.tick(keeper.publicKey, r.pick(l.worlds), module)], signers: [keeper] };
      }],
      ["settle", 1, () => {
        const w = r.pick(l.worlds), i = r.int(16), t = holderOf(w, i);
        return t ? { ixs: [c.rx.settle(w, i, t.holder)], signers: [keeper] } : null;
      }],
      ["warp", 1, () => { c.warp(r.big(P.epochSlots / 3n)); return null; }],
      ["epoch", 2, () => {
        const cfg = c.config();
        if (c.slot < cfg.epochStartSlot + cfg.params.epochSlots) return null;
        return { ixs: [c.rx.advanceEpoch()], signers: [keeper] };
      }],
      ["claim_world_epoch", 2, () => ({ ixs: [c.rx.claimWorldEpoch(r.pick(l.worlds))], signers: [keeper] })],
      ["tournament_join", 1, () => {
        const k = r.pick(users);
        return { ixs: [c.rx.tournamentJoin(k.publicKey, c.config().seasonId, r.int(3))], signers: [k] };
      }],
      ["season_submit", 1, () => ({ ixs: [c.rx.seasonSubmit(r.pick(users).publicKey)], signers: [keeper] })],
      ["tournament_submit", 1, () => ({ ixs: [c.rx.tournamentSubmit(r.pick(users).publicKey, c.config().seasonId, r.int(2))], signers: [keeper] })],
      ["tournament_settle", 1, () => {
        const s = c.config().seasonId;
        return s > 1n ? { ixs: [c.rx.tournamentSettle(s - 1n, r.int(2))], signers: [keeper] } : null;
      }],
    ];
    const total = actions.reduce((a, x) => a + x[1], 0);

    for (let step = 0; step < STEPS; step++) {
      let roll = r.int(total), k = 0;
      while (roll >= actions[k][1]) roll -= actions[k++][1];
      const [name, , build] = actions[k];
      const tx = build();
      if (!tx) continue;
      const st = stats.get(name) ?? { ok: 0, rejected: 0 }; stats.set(name, st);
      trace(`#${step} ${name}`);
      try {
        c.send(tx.ixs, tx.signers);
        st.ok++;
      } catch (e) {
        if (!(e instanceof ChainError)) throw e;
        st.rejected++;
        if (BUG.test(e.code) || e.logs.some((x) => BUG.test(x))) {
          throw new Error(`step ${step} ${name}: bug-class failure ${e.code}\n${e.logs.slice(-15).join("\n")}`);
        }
      }
      checkInvariants(c, l, `step ${step} ${name}`);
    }

    const summary = [...stats.entries()].map(([n, s]) => `${n} ${s.ok}/${s.ok + s.rejected}`).join(", ");
    trace(`fuzz summary: ${summary}`);
    // the walk must actually exercise the money paths, not just bounce off validation
    // coverage is asserted for the pinned default seed; random (nightly) seeds only report it
    console.log(`money fuzz seed ${SEED}: ${summary}`);
    if (!process.env.FUZZ_SEED) {
      for (const n of ["acquire", "tick", "plant", "top_up"]) expect(stats.get(n)?.ok ?? 0, `${n} never succeeded (${summary})`).toBeGreaterThan(0);
      expect(c.config().curEpoch, "no epoch closed during the walk").toBeGreaterThan(1n);
    }
  }, 300_000); // runs the compiled program step by step: far beyond the 5 s default on CI runners
});
