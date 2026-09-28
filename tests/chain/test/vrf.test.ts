/**
 * Integration: ORAO VRF on the compiled program (LiteSVM).
 *
 * ORAO itself is not loaded: its RandomnessV2 account is planted with
 * `setAccount` (owner = ORAO program), exactly as the real oracle leaves it.
 * Checks: the seed is fixed at commit from the latest slot hash; observe
 * refuses a missing / pending / foreign-owned / wrong-PDA account; a fulfilled
 * answer sets entropy = H(randomness); an unobserved position is never slashed.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, SYSVAR_SLOT_HASHES_PUBKEY } from "@solana/web3.js";
import {
  DEFAULT_PARAMS, ONE, ORAO_VRF_ID, PHYSICS_PRESETS, QUANTUM_BOUNTY_DIV, QUANTUM_REVEAL_SLOTS,
  commitment, decodeSuperposition, entropyFromVrf, epochTax, oraoFulfilledAccountData, oraoRandomnessPda, randomSalt, vrfSeedSuperposition,
} from "@recursia/sdk";
import { Chain, HAVE_SO, trace } from "./harness.js";
import { checkInvariants } from "./invariants.js";

const P = DEFAULT_PARAMS;
const run = HAVE_SO ? describe : describe.skip;
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

run("ORAO VRF measurement on the real program (LiteSVM)", () => {
  beforeEach((ctx) => trace(`== ${ctx.task.name}`));
  let c: Chain;
  let studio: Keypair, alice: Keypair, keeper: Keypair;
  let world: PublicKey;
  const idx = 9;
  const players: PublicKey[] = [];
  const worlds: PublicKey[] = [];
  const secret = { a: 0x0000_0018_1800_0000n, b: 0n, w: 5_000, salt: randomSalt() };
  let seed: Uint8Array;
  const invariants = (step: string) => checkInvariants(c, { rewardFunded: 1_000_000n * ONE, players, worlds }, step);
  const sp = () => c.account(c.pda.superposition(world, idx), decodeSuperposition)!;
  const plant = (data: Uint8Array, owner = ORAO_VRF_ID, key = oraoRandomnessPda(seed)) =>
    c.svm.setAccount(key, { lamports: Number(c.svm.minimumBalanceForRentExemption(BigInt(data.length))), data, owner, executable: false });

  beforeAll(() => {
    c = new Chain();
    [studio, alice, keeper] = [c.wallet(10_000_000n * ONE), c.wallet(1_000_000n * ONE), c.wallet(0n)];
    players.push(studio.publicKey, alice.publicKey, keeper.publicKey);
    c.send([c.rx.initialize(c.upgradeAuthority.publicKey, studio.publicKey, P)], [c.upgradeAuthority]);
    c.send([c.rx.fundRewardPool(studio.publicKey, 1_000_000n * ONE)], [studio]);
    const conway = PHYSICS_PRESETS[0];
    const id = c.config().modules;
    c.send([c.rx.registerModule(studio.publicKey, id, conway.birth, conway.survive, conway.royaltyBps, conway.name)], [studio]);
    const created = c.rx.createRootWorld(alice.publicKey, c.config().rootWorlds, c.pda.module(id), 1_000, "Quantum", 200_000n * ONE);
    c.send([created.ix], [alice]);
    world = created.world; worlds.push(world);
    c.tokenAccounts.add(c.pda.worldVault(world).toBase58());
    const price = 1_000n * ONE;
    c.send([c.rx.acquire(alice.publicKey, world, idx, null, P.minPrice, price, epochTax(price, P.harbergerBps) * 40n)], [alice]);
    invariants("setup");
  });

  it("commit fixes the VRF seed from the latest slot hash (unknown before the commit slot)", () => {
    c.warp(10n);
    const cm = commitment(secret.a, secret.b, secret.w, secret.salt, alice.publicKey.toBytes(), world.toBytes(), idx);
    c.send([c.rx.quantumCommit(alice.publicKey, world, idx, cm)], [alice]);
    const hashes = Uint8Array.from(c.svm.getAccount(SYSVAR_SLOT_HASHES_PUBKEY)!.data);
    const latest = hashes.subarray(16, 48); // [len u64][slot u64][hash 32]...
    seed = sp().entropy;
    expect(eq(seed, vrfSeedSuperposition(world.toBytes(), idx, cm, latest))).toBe(true);
    expect(sp().observed).toBe(false);
    invariants("commit");
  });

  it("observe refuses: no request, wrong PDA, pending, foreign owner", () => {
    c.warp(BigInt(sp().targetSlot) - c.slot + 1n);
    const obs = (vrf: PublicKey) => [c.rx.quantumObserve(keeper.publicKey, world, idx, vrf)];
    c.expectFail("VrfPending", obs(oraoRandomnessPda(seed)), [keeper]); // nobody asked ORAO yet
    c.expectFail("Mismatch", obs(Keypair.generate().publicKey), [keeper]); // not the seed's PDA
    const randomness = new Uint8Array(64).fill(0xab);
    const fulfilled = oraoFulfilledAccountData(seed, randomness);
    const pending = Uint8Array.from(fulfilled); pending[8] = 0; pending.fill(0, 73); // tag Pending, no randomness
    plant(pending);
    c.expectFail("VrfPending", obs(oraoRandomnessPda(seed)), [keeper]);
    plant(fulfilled, Keypair.generate().publicKey); // forged "answer" owned by an attacker program
    c.expectFail("VrfPending", obs(oraoRandomnessPda(seed)), [keeper]);
    const otherSeed = oraoFulfilledAccountData(new Uint8Array(32).fill(1), randomness); // answer for a different seed
    plant(otherSeed);
    c.expectFail("VrfPending", obs(oraoRandomnessPda(seed)), [keeper]);
    expect(sp().observed).toBe(false);
    invariants("refusals");
  });

  it("an unobserved superposition is never slashed, even long after the window", () => {
    c.warp(BigInt(QUANTUM_REVEAL_SLOTS) * 2n);
    c.expectFail("StillCoherent", [c.rx.quantumDecohere(keeper.publicKey, world, idx, alice.publicKey)], [keeper]);
    expect(sp().stake).toBeGreaterThan(0n);
  });

  it("fulfilled answer: entropy = H(randomness), observer gets the bounty, owner collapses", () => {
    const randomness = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
    plant(oraoFulfilledAccountData(seed, randomness));
    const stake = sp().stake;
    const before = c.skr(keeper.publicKey);
    c.send([c.rx.quantumObserve(keeper.publicKey, world, idx, oraoRandomnessPda(seed))], [keeper]);
    expect(sp().observed).toBe(true);
    expect(eq(sp().entropy, entropyFromVrf(randomness))).toBe(true);
    expect(c.skr(keeper.publicKey) - before).toBe(stake / QUANTUM_BOUNTY_DIV);
    // a second observe can't re-roll
    c.expectFail("AlreadyObserved", [c.rx.quantumObserve(keeper.publicKey, world, idx, oraoRandomnessPda(seed))], [keeper]);
    const a0 = c.skr(alice.publicKey);
    c.send([c.rx.quantumCollapse(alice.publicKey, world, idx, secret.a, secret.b, secret.w, secret.salt)], [alice]);
    expect(c.skr(alice.publicKey) - a0).toBe(stake - stake / QUANTUM_BOUNTY_DIV);
    expect(c.account(c.pda.superposition(world, idx), decodeSuperposition)).toBeNull();
    invariants("collapse");
  });
});
