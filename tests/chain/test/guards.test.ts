/**
 * Adversarial tests of the breakers (checklist #94/#101/#110/#111):
 * pause, timelock, nonce binding, treasury cap, zero/dust money paths and the
 * rebellion hold-up are poked the way an attacker would, not just the happy
 * path. Runs on the compiled program in LiteSVM; every step is followed by the
 * shared money invariants.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PublicKey, type Keypair } from "@solana/web3.js";
import { DEFAULT_PARAMS, ONE, PHYSICS_PRESETS, REBELLION_HOLD_DIV, ata, epochTax } from "@recursia/sdk";
import { Chain, HAVE_SO, REQUIRE_SO, trace } from "./harness.js";
import { checkInvariants } from "./invariants.js";

const P = DEFAULT_PARAMS;
const BLOCKS = 0x0000_0018_1800_0000n; // still life: stays alive every tick
const run = HAVE_SO ? describe : describe.skip;

it("the compiled program is present when CI requires it", () => {
  if (REQUIRE_SO) expect(HAVE_SO).toBe(true);
});

run("adversarial guards on the real program (LiteSVM)", () => {
  beforeEach((ctx) => trace(`== ${ctx.task.name}`));
  let c: Chain;
  let studio: Keypair, dev: Keypair, alice: Keypair, bob: Keypair, keeper: Keypair, mallory: Keypair;
  let world: PublicKey, module: PublicKey;
  let rewardFunded = 0n;
  const players: PublicKey[] = [];
  const worlds: PublicKey[] = [];
  const rebels: Keypair[] = [];

  const invariants = (step: string) => checkInvariants(c, { rewardFunded, players, worlds }, step);
  const price = 1_000n * ONE;
  const dep = epochTax(price, P.harbergerBps) * 40n;

  function tickOnce() { c.warp(P.tickIntervalSlots); c.send([c.rx.tick(keeper.publicKey, world, module)], [keeper]); }
  function toEpochEnd() {
    const cfg = c.config();
    const end = cfg.epochStartSlot + cfg.params.epochSlots;
    if (c.slot < end) c.warp(end - c.slot);
  }

  beforeAll(() => {
    c = new Chain();
    [studio, dev, alice, bob, keeper, mallory] = [
      c.wallet(10_000_000n * ONE), c.wallet(1_000_000n * ONE), c.wallet(10_000_000n * ONE),
      c.wallet(1_000_000n * ONE), c.wallet(0n), c.wallet(100_000n * ONE),
    ];
    for (let i = 0; i < 9; i++) rebels.push(c.wallet(10_000_000n * ONE));
    for (const k of [studio, dev, alice, bob, keeper, mallory, ...rebels]) players.push(k.publicKey);

    c.send([c.rx.initialize(c.upgradeAuthority.publicKey, studio.publicKey, P)], [c.upgradeAuthority]);
    c.send([c.rx.fundRewardPool(studio.publicKey, 1_000_000n * ONE)], [studio]);
    rewardFunded = 1_000_000n * ONE;
    const conway = PHYSICS_PRESETS[0];
    const id = c.config().modules;
    c.send([c.rx.registerModule(dev.publicKey, id, conway.birth, conway.survive, conway.royaltyBps, conway.name)], [dev]);
    module = c.pda.module(id);
    const rootIndex = c.config().rootWorlds;
    const created = c.rx.createRootWorld(alice.publicKey, rootIndex, module, 1_000, "Holdfast", 200_000n * ONE);
    c.send([created.ix], [alice]);
    world = created.world; worlds.push(world);
    c.tokenAccounts.add(c.pda.worldVault(world).toBase58());
    expect(c.world(world).architect.equals(alice.publicKey)).toBe(true);
    // bob's first land also creates his Player account (used by the money-path checks)
    c.send([c.rx.acquire(bob.publicKey, world, 9, null, P.minPrice, price, dep)], [bob]);
    invariants("setup");
  });

  it("zero and dust amounts are rejected on every money path (#111)", () => {
    c.expectFail("ZeroAmount", [c.rx.fundRewardPool(studio.publicKey, 0n)], [studio]);
    c.expectFail("ZeroAmount", [c.rx.fundSponsorPool(studio.publicKey, 0n)], [studio]);
    c.expectFail("NothingToClaim", [c.rx.fundWorld(bob.publicKey, world, 0n)], [bob]);
    c.expectFail("InvalidParams", [c.rx.propose(studio.publicKey, { kind: "TreasurySpend", amount: 0n, recipient: ata(studio.publicKey, c.mint) })], [studio]);
    c.expectFail("DepositTooSmall", [c.rx.topUp(bob.publicKey, world, 9, 0n)], [bob]);
    c.expectFail("DepositTooSmall", [c.rx.withdrawDeposit(bob.publicKey, world, 9, 0n)], [bob]);
    c.expectFail("NothingToClaim", [c.rx.withdraw(bob.publicKey, 0n)], [bob]);
    c.expectFail("NothingToClaim", [c.rx.collect(bob.publicKey, world, 9)], [bob]); // nothing pending yet
    c.expectFail("NothingToClaim", [c.rx.claimArchitect(alice.publicKey, world)], [alice]); // accrued = 0
    invariants("zero/dust");
  });

  it("a player earns, then pause blocks spending but never money (#110)", () => {
    c.send([c.rx.plant(bob.publicKey, world, 9, BLOCKS)], [bob]);
    // real earn flow until something is actually withdrawable (bounded)
    let owed = 0n;
    for (let e = 0; e < 5 && owed === 0n; e++) {
      tickOnce();
      toEpochEnd();
      c.send([c.rx.advanceEpoch()], [keeper]);
      c.send([c.rx.claimWorldEpoch(world)], [keeper]);
      try { c.send([c.rx.collect(bob.publicKey, world, 9)], [bob]); } catch { /* nothing pending this epoch */ }
      owed = c.player(bob.publicKey)?.claimable ?? 0n;
    }
    expect(owed, "bob must earn something to withdraw").toBeGreaterThan(0n);
    invariants("earn");

    const [tr0, rp0, cl0] = [c.bal(c.pda.treasury()), c.bal(c.pda.rewardPool()), c.bal(c.pda.claims())];
    c.send([c.rx.setPause(studio.publicKey, true)], [studio]);
    expect(c.config().paused).toBe(true);
    // gameplay is frozen…
    c.expectFail("Paused", [c.rx.acquire(mallory.publicKey, world, 20, null, P.minPrice, price, dep)], [mallory]);
    c.expectFail("Paused", [c.rx.tick(keeper.publicKey, world, module)], [keeper]);
    // …the pause itself moved no money…
    expect([c.bal(c.pda.treasury()), c.bal(c.pda.rewardPool()), c.bal(c.pda.claims())]).toEqual([tr0, rp0, cl0]);
    // …and credited balances are never trapped
    const w0 = c.skr(bob.publicKey);
    c.send([c.rx.withdraw(bob.publicKey, owed)], [bob]);
    expect(c.skr(bob.publicKey) - w0).toBe(owed);
    expect(c.player(bob.publicKey)!.claimable).toBe(0n);
    invariants("pause");
    // stays paused for the governance drill below
  });

  it("governance under attack while paused: nonce binding, timelock, cap, cancel (#94/#101/#110)", () => {
    expect(c.config().paused).toBe(true); // proposals must keep working during an incident
    const dest = ata(studio.publicKey, c.mint);
    c.expectFail(/Unauthorized|ConstraintHasOne/, [c.rx.propose(mallory.publicKey, { kind: "SetAdmin", admin: mallory.publicKey })], [mallory]);
    c.expectFail("InvalidParams", [c.rx.propose(studio.publicKey, { kind: "TreasurySpend", amount: 0n, recipient: dest })], [studio]);
    const seen = c.config().treasurySeen;
    const amount = seen > 0n ? seen : 1n; // boundary: spend exactly the spendable cap
    c.send([c.rx.propose(studio.publicKey, { kind: "TreasurySpend", amount, recipient: dest })], [studio]);
    const nonce = c.config().pendingNonce;
    c.expectFail("ActionAlreadyPending", [c.rx.propose(studio.publicKey, { kind: "SetAdmin", admin: studio.publicKey })], [studio]);
    // the signature is bound to THIS proposal — a wrong nonce fails even before the timelock
    c.expectFail("Mismatch", [c.rx.execute(studio.publicKey, nonce + 1n, dest)], [studio]);
    // an attacker without the admin key cannot even serialize this transaction:
    // the admin is a required signer of the message
    expect(() => c.send([c.rx.execute(studio.publicKey, nonce, dest)], [mallory])).toThrow(/Missing signature/);
    c.expectFail("TimelockActive", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
    c.warp(1_000n, P.timelockSecs + 10n);
    if (seen > 0n) {
      const t0 = c.bal(c.pda.treasury());
      c.send([c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
      expect(c.bal(c.pda.treasury())).toBe(t0 - seen);
      expect(c.config().treasurySeen).toBe(0n);
      c.expectFail("NoPendingAction", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]); // no double-spend
      c.expectFail("NoPendingAction", [c.rx.cancel(studio.publicKey)], [studio]); // nothing to cancel
    } else {
      // treasury never saw a split: nothing is spendable at all
      c.expectFail("TreasuryLocked", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
      c.expectFail(/Unauthorized|ConstraintHasOne/, [c.rx.cancel(mallory.publicKey)], [mallory]);
      c.send([c.rx.cancel(studio.publicKey)], [studio]);
      c.expectFail("NoPendingAction", [c.rx.execute(studio.publicKey, nonce, dest)], [studio]);
    }
    // the failed/successful attempts never unpaused anything by themselves
    expect(c.config().paused).toBe(true);
    c.send([c.rx.setPause(studio.publicKey, false)], [studio]);
    expect(c.config().paused).toBe(false);
    invariants("governance");
  });

  it("rebellion: pause can veto it and execution waits out the hold-up (#94)", () => {
    for (let i = 0; i < rebels.length; i++) {
      c.send([c.rx.acquire(rebels[i].publicKey, world, 30 + i, null, P.minPrice, price, dep)], [rebels[i]]);
    }
    c.warp(5n); // territories must predate the rebellion (anti flash-buy)
    // the admin veto: while paused, no rebellion can even start
    c.send([c.rx.setPause(studio.publicKey, true)], [studio]);
    c.expectFail("Paused", [c.rx.startRebellion(rebels[0].publicKey, world, 30)], [rebels[0]]);
    c.send([c.rx.setPause(studio.publicKey, false)], [studio]);

    c.send([c.rx.startRebellion(rebels[0].publicKey, world, 30)], [rebels[0]]);
    for (let i = 1; i < 8; i++) c.send([c.rx.voteRebellion(rebels[i].publicKey, world, 30 + i)], [rebels[i]]);
    expect(c.world(world).rebellionVotes).toBe(8);
    // quorum (8 votes ≥ 2/3 of the 10 owned territories) is NOT enough right now:
    // the hold-up blocks execute — and with it any atomic start+vote+execute
    const architectBefore = c.world(world).architectAccrued;
    const aliceClaimBefore = c.player(alice.publicKey)?.claimable ?? 0n;
    c.expectFail("RebellionUnavailable", [c.rx.executeRebellion(rebels[8].publicKey, world, alice.publicKey)], [rebels[8]]);
    c.warp(BigInt(Math.floor(Number(P.epochSlots) / REBELLION_HOLD_DIV)));
    c.send([c.rx.executeRebellion(rebels[8].publicKey, world, alice.publicKey)], [rebels[8]]);
    const w = c.world(world);
    expect(w.liberated).toBe(true);
    expect(w.architect.equals(PublicKey.default)).toBe(true);
    expect(w.architectAccrued).toBe(0n);
    // the former architect keeps what they already earned
    expect(c.player(alice.publicKey)!.claimable).toBe(aliceClaimBefore + architectBefore);
    // a liberated world takes no more votes
    c.expectFail("RebellionUnavailable", [c.rx.voteRebellion(rebels[8].publicKey, world, 38)], [rebels[8]]);
    invariants("rebellion");
  });
});
