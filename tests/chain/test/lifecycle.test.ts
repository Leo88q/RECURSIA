/**
 * Integration: the compiled program in LiteSVM, one full season.
 *
 * init → worlds → land → planting → ticks → 7 epochs (emission, efficiency
 * share, collect, season/tournament standings) → season close → tournament
 * settle/claim → withdraw. After EVERY step the on-chain money invariants
 * are checked; attack attempts are made at the points where they would hurt.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PublicKey, type Keypair } from "@solana/web3.js";
import {
  DEFAULT_PARAMS, EFFICIENCY_CAP_BPS, EFFICIENCY_SHARE_BPS, ONE, PHYSICS_PRESETS, SEASON_EPOCHS, TOURNAMENT_TIERS,
  ata, bpsFloor, epochTax, tournamentPlaces, tournamentPrizes, worldEmission, worldSponsor,
} from "@recursia/sdk";
import { Chain, HAVE_SO, REQUIRE_SO, trace } from "./harness.js";
import { checkInvariants } from "./invariants.js";

const P = DEFAULT_PARAMS;
const BLOCKS = 0x0000_0018_1800_0000n; // still life: stays alive every tick
const run = HAVE_SO ? describe : describe.skip;

it("the compiled program is present when CI requires it", () => {
  if (REQUIRE_SO) expect(HAVE_SO).toBe(true);
});

run("season lifecycle on the real program (LiteSVM)", () => {
  beforeEach((ctx) => trace(`== ${ctx.task.name}`));
  let c: Chain;
  let studio: Keypair, dev: Keypair, alice: Keypair, bob: Keypair, carol: Keypair, dave: Keypair, keeper: Keypair, mallory: Keypair;
  let world: PublicKey, module: PublicKey;
  let rewardFunded = 0n;
  const players: PublicKey[] = [];
  const worlds: PublicKey[] = [];

  const invariants = (step: string) => checkInvariants(c, { rewardFunded, players, worlds }, step);

  function tick(n = 3) {
    for (let i = 0; i < n; i++) { c.warp(P.tickIntervalSlots); c.send([c.rx.tick(keeper.publicKey, world, module)], [keeper]); }
  }
  function toEpochEnd() {
    const cfg = c.config();
    const end = cfg.epochStartSlot + cfg.params.epochSlots;
    if (c.slot < end) c.warp(end - c.slot);
  }

  beforeAll(() => {
    c = new Chain();
    [studio, dev, alice, bob, carol, dave, keeper, mallory] = [
      c.wallet(10_000_000n * ONE), c.wallet(1_000_000n * ONE), c.wallet(1_000_000n * ONE), c.wallet(100_000n * ONE),
      c.wallet(100_000n * ONE), c.wallet(100_000n * ONE), c.wallet(0n), c.wallet(100_000n * ONE),
    ];
    for (const k of [studio, dev, alice, bob, carol, dave, keeper, mallory]) players.push(k.publicKey);
  });

  it("initialize: only the upgrade authority", () => {
    c.expectFail("Unauthorized", [c.rx.initialize(mallory.publicKey, mallory.publicKey, P)], [mallory]);
    c.send([c.rx.initialize(c.upgradeAuthority.publicKey, studio.publicKey, P)], [c.upgradeAuthority]);
    const cfg = c.config();
    expect(cfg.admin.equals(studio.publicKey)).toBe(true);
    expect(cfg.params.rebateCapBps).toBe(10_000);
    expect(cfg.seasonId).toBe(1n);
    // a second initialize can never re-seat the admin
    c.expectFail(/AlreadyInUse|custom program error/, [c.rx.initialize(c.upgradeAuthority.publicKey, mallory.publicKey, P)], [c.upgradeAuthority]);
    invariants("init");
  });

  it("studio seeds the reward pool; module + world creation", () => {
    c.send([c.rx.fundRewardPool(studio.publicKey, 1_000_000n * ONE)], [studio]); rewardFunded += 1_000_000n * ONE;
    const conway = PHYSICS_PRESETS[0];
    const id = c.config().modules;
    c.send([c.rx.registerModule(dev.publicKey, id, conway.birth, conway.survive, conway.royaltyBps, conway.name)], [dev]);
    module = c.pda.module(id);
    trace("module pda ok");
    const rootIndex = c.config().rootWorlds;
    trace(`root index ${rootIndex}`);
    const created = c.rx.createRootWorld(alice.publicKey, rootIndex, module, 1_000, "Genesis", 200_000n * ONE);
    trace(`createRootWorld ix built (${created.ix.keys.length} keys, ${created.ix.data.length} bytes)`);
    c.send([created.ix], [alice]);
    world = created.world; worlds.push(world);
    c.tokenAccounts.add(c.pda.worldVault(world).toBase58());
    expect(c.world(world).architect.equals(alice.publicKey)).toBe(true);
    invariants("world");
  });

  it("land: acquire, and a buyer can't grab land below the floor or without deposit", () => {
    const price = 1_000n * ONE;
    const dep = epochTax(price, P.harbergerBps) * 40n;
    c.expectFail("BadPrice", [c.rx.acquire(bob.publicKey, world, 9, null, P.minPrice, P.minPrice - 1n, dep)], [bob]);
    c.expectFail("DepositTooSmall", [c.rx.acquire(bob.publicKey, world, 9, null, P.minPrice, price, 0n)], [bob]);
    c.send([c.rx.acquire(bob.publicKey, world, 9, null, P.minPrice, price, dep)], [bob]);
    c.send([c.rx.acquire(carol.publicKey, world, 20, null, P.minPrice, price, dep)], [carol]);
    expect(c.territory(world, 9)!.holder.equals(bob.publicKey)).toBe(true);
    invariants("acquire");
  });

  it("tournament join: fee split, one entry per wallet, bad tier / season rejected", () => {
    const fee = P.plantCost * TOURNAMENT_TIERS[0];
    const treasury0 = c.bal(c.pda.treasury());
    for (const k of [bob, carol, dave]) c.send([c.rx.tournamentJoin(k.publicKey, 1n, 0)], [k]);
    const t = c.tournament(1n, 0)!;
    expect(t.players).toBe(3);
    expect(t.entryFee).toBe(fee);
    expect(t.pot).toBe(3n * (fee - fee / 10n));
    expect(c.bal(c.pda.treasury()) - treasury0).toBe(3n * (fee / 10n));
    c.expectFail(/AlreadyInUse|custom program error/, [c.rx.tournamentJoin(bob.publicKey, 1n, 0)], [bob]);
    c.expectFail("BadTier", [c.rx.tournamentJoin(mallory.publicKey, 1n, 7)], [mallory]);
    c.expectFail("TournamentClosed", [c.rx.tournamentJoin(mallory.publicKey, 2n, 0)], [mallory]);
    invariants("join");
  });

  it("planting: owner only, then cooldown", () => {
    c.expectFail(/NotHolder|AccountNotInitialized|Unauthorized|Mismatch|ConstraintSeeds/, [c.rx.plant(mallory.publicKey, world, 9, BLOCKS)], [mallory]);
    c.send([c.rx.plant(bob.publicKey, world, 9, BLOCKS)], [bob]);
    c.expectFail("Cooldown", [c.rx.plant(bob.publicKey, world, 9, BLOCKS)], [bob]);
    tick(3);
    invariants("plant+tick");
  });

  it(`${SEASON_EPOCHS} epochs: emission = rebate + efficiency exactly as the reference formulas; collect; standings`, () => {
    let efficiencySeen = 0n;
    for (let e = 0; e < SEASON_EPOCHS; e++) {
      if (e > 0) tick(3);
      toEpochEnd();
      c.send([c.rx.advanceEpoch()], [keeper]);
      invariants(`advance ${e}`);
      // expected reward from the pre-claim state (world epoch rolls lazily inside the claim)
      const cfg = c.config(); const w = c.world(world);
      const rolled = w.epochId < cfg.curEpoch;
      const sink = rolled ? w.sinkCur : w.sinkPrev;
      const score = rolled ? w.scoreOwnedCur : w.scoreOwnedPrev;
      const effBudget = bpsFloor(cfg.prevEmission, EFFICIENCY_SHARE_BPS);
      const rebate = worldEmission(cfg.prevEmission - effBudget, cfg.prevTotalSink, sink, cfg.params.rebateCapBps, cfg.prevClaimed);
      const eff = worldSponsor(effBudget, cfg.prevTotalScore, score, sink, EFFICIENCY_CAP_BPS, cfg.prevEffClaimed);
      const pool0 = c.bal(c.pda.rewardPool());
      c.send([c.rx.claimWorldEpoch(world)], [keeper]);
      expect(pool0 - c.bal(c.pda.rewardPool()), `epoch ${e}: reward`).toBe(rebate + eff);
      efficiencySeen += eff;
      // a second claim of the same epoch pays nothing
      const pool1 = c.bal(c.pda.rewardPool());
      try { c.send([c.rx.claimWorldEpoch(world)], [keeper]); } catch { /* rejected is fine too */ }
      expect(c.bal(c.pda.rewardPool())).toBe(pool1);
      invariants(`claim ${e}`);
      if (e < SEASON_EPOCHS - 1) {
        // mallory can't collect bob's rewards
        c.expectFail(/NotHolder|AccountNotInitialized|Unauthorized|Mismatch|ConstraintSeeds/, [c.rx.collect(mallory.publicKey, world, 9)], [mallory]);
        for (const [k, i] of [[bob, 9], [carol, 20]] as const) { try { c.send([c.rx.collect(k.publicKey, world, i)], [k]); } catch { /* nothing pending */ } }
        for (const k of [bob, carol]) {
          const pts = c.player(k.publicKey)?.seasonPoints ?? 0n;
          if (pts > 0n) {
            c.send([c.rx.seasonSubmit(k.publicKey)], [keeper]);
            c.send([c.rx.tournamentSubmit(k.publicKey, 1n, 0)], [keeper]);
          }
        }
        invariants(`collect ${e}`);
      }
    }
    expect(efficiencySeen, "live owned cells earned an efficiency share").toBeGreaterThan(0n);
    expect(c.config().seasonId).toBe(2n);
  });

  it("score injection: an entry can't be scored with someone else's player account", () => {
    // season 1 is closed: any submit is rejected, and cross-account submits are rejected by constraint first
    c.expectFail(/Mismatch|TournamentClosed/, [c.rx.tournamentSubmit(bob.publicKey, 1n, 0)].map((ix) => {
      const keys = ix.keys.slice(); keys[3] = { ...keys[3], pubkey: c.pda.player(carol.publicKey) }; ix.keys = keys; return ix;
    }), [keeper]);
    c.expectFail("TournamentClosed", [c.rx.tournamentSubmit(bob.publicKey, 1n, 0)], [keeper]);
  });

  it("tournament settle: exact prizes, fake pool rejected, remainder back to players' pool", () => {
    const t0 = c.tournament(1n, 0)!;
    expect(t0.settled).toBe(false);
    // a fake "tournament pool" owned by mallory can't receive the funds
    const fake = c.wallet(0n); // its ATA is a valid SKR token account, but not the PDA
    const ix = c.rx.tournamentSettle(1n, 0); const keys = ix.keys.slice();
    keys[3] = { ...keys[3], pubkey: ata(fake.publicKey, c.mint) }; ix.keys = keys;
    c.expectFail(/ConstraintSeeds|ConstraintTokenOwner|ConstraintAddress/, [ix], [mallory]);

    const pool0 = c.bal(c.pda.rewardPool());
    c.send([c.rx.tournamentSettle(1n, 0)], [mallory]); // permissionless
    c.expectFail("TournamentClosed", [c.rx.tournamentSettle(1n, 0)], [mallory]);
    const t = c.tournament(1n, 0)!;
    const filled = t0.top.filter((e) => !e.player.equals(PublicKey.default) && e.points > 0n).length;
    const k = Math.min(tournamentPlaces(t0.players), filled);
    const { prizes, rest } = tournamentPrizes(t0.pot, k);
    expect(t.prizes).toEqual(prizes);
    expect(t.settled).toBe(true);
    expect(c.bal(c.pda.rewardPool()) - pool0).toBe(rest);
    invariants("settle");
  });

  it("tournament claim: only to the winner, only once", () => {
    const t = c.tournament(1n, 0)!;
    const winner = t.top[0].player;
    if (t.prizes[0] === 0n) return; // nobody scored (would already be covered by settle checks)
    const loser = winner.equals(bob.publicKey) ? carol.publicKey : bob.publicKey;
    c.expectFail("NoPrize", [c.rx.claimTournamentPrize(loser, 1n, 0, 0)], [mallory]);
    const before = c.player(winner)!.claimable;
    c.send([c.rx.claimTournamentPrize(winner, 1n, 0, 0)], [mallory]);
    expect(c.player(winner)!.claimable - before).toBe(t.prizes[0]);
    c.expectFail("NoPrize", [c.rx.claimTournamentPrize(winner, 1n, 0, 0)], [mallory]);
    invariants("claim prize");
  });

  it("season prizes are claimable and conserve money", () => {
    const s = c.season();
    for (let r = 0; r < s.lastTop.length; r++) {
      if (s.lastPrizes[r] === 0n) continue;
      c.send([c.rx.claimSeasonPrize(s.lastTop[r].player, r)], [keeper]);
      c.expectFail("NoPrize", [c.rx.claimSeasonPrize(s.lastTop[r].player, r)], [keeper]);
    }
    invariants("season prizes");
  });

  it("withdraw: only own balance, exact amounts", () => {
    const p = c.player(bob.publicKey)!;
    expect(p.claimable).toBeGreaterThan(0n);
    c.expectFail("NothingToClaim", [c.rx.withdraw(bob.publicKey, p.claimable + 1n)], [bob]);
    const w0 = c.skr(bob.publicKey);
    c.send([c.rx.withdraw(bob.publicKey, p.claimable)], [bob]);
    expect(c.skr(bob.publicKey) - w0).toBe(p.claimable);
    expect(c.player(bob.publicKey)!.claimable).toBe(0n);
    invariants("withdraw");
  });

  it("governance: non-admin can't propose; treasury spend waits for the timelock and is capped by treasury_seen", () => {
    c.expectFail(/Unauthorized|ConstraintHasOne/, [c.rx.propose(mallory.publicKey, { kind: "SetAdmin", admin: mallory.publicKey })], [mallory]);
    const seen = c.config().treasurySeen;
    expect(seen).toBeGreaterThan(0n);
    const dest = ata(studio.publicKey, c.mint);
    c.send([c.rx.propose(studio.publicKey, { kind: "TreasurySpend", amount: seen + 1n, recipient: dest })], [studio]);
    const nonce = c.config().pendingNonce;
    c.expectFail("TimelockActive", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
    c.warp(1_000n, P.timelockSecs + 10n);
    c.expectFail("TreasuryLocked", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
    c.send([c.rx.cancel(studio.publicKey)], [studio]);
    invariants("governance");
  });
});
