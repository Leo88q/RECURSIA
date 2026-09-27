/**
 * Stateful fuzzing of the WHOLE instruction surface on the compiled program
 * (checklist #54), complementing fuzz.test.ts (money core).
 *
 * Families: quantum layer (commit / entangle / observe / collapse / decohere),
 * neutral-world SWAP (offer / accept / resolve / cancel), nested worlds
 * (child / breach / host tax), rebellion, AI-agent permits (create / fund /
 * withdraw / revoke / agent_plant / agent_acquire), module royalties,
 * architect claims, governance (propose / cancel / execute / pause).
 *
 * Honest moves are mixed with attacks: wrong signers, stale holders, forged or
 * foreign ORAO answers, wrong reveal secrets, agents outside their permit.
 * After EVERY step the money invariants hold — including the EXACT sub-ledgers
 * (world.deposits == Σ deposits, quantum_escrow == Σ stakes + Σ swap escrow).
 * A "bug-class" rejection (panic, overflow, InvariantViolated, CU exhaustion)
 * fails the run. FUZZ_SEED / FUZZ_STEPS reproduce or extend it.
 */
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  DEFAULT_PARAMS, ONE, ORAO_VRF_ID, PHYSICS_PRESETS, commitment, decodePermit, decodeSuperposition, decodeSwap,
  ata, epochTax, oraoFulfilledAccountData, oraoRandomnessPda,
} from "@recursia/sdk";
import { Chain, ChainError, HAVE_SO, trace } from "./harness.js";
import { checkInvariants, type Ledger } from "./invariants.js";

const P = DEFAULT_PARAMS;
const SEED = Number(process.env.FUZZ_SEED ?? 20260928);
const STEPS = Number(process.env.FUZZ_STEPS ?? 500);
const BUG = /ProgramFailedToComplete|panicked|InvariantViolated|MathOverflow|ArithmeticOverflow|AccessViolation|ComputationalBudgetExceeded|exceeded CUs/;
const PATTERNS = [0x0000_0018_1800_0000n, 0x0000_1824_2418_0000n, 0x0000_0000_0e00_0000n, 0xffff_ffff_ffff_ffffn, 0n, 0x0102_0408_1020_4080n];
const SPOTS = 12; // territories in play per world (of 64): dense enough for swaps / rebellion
const run = HAVE_SO ? describe : describe.skip;

function rng(seed: number) {
  let s = BigInt(seed) || 1n;
  const next = () => { s ^= (s << 13n) & 0xffff_ffff_ffff_ffffn; s ^= s >> 7n; s ^= (s << 17n) & 0xffff_ffff_ffff_ffffn; return s; };
  return {
    int: (n: number) => Number(next() % BigInt(n)),
    big: (n: bigint) => (n <= 0n ? 0n : next() % n),
    pick: <T>(a: readonly T[]) => a[Number(next() % BigInt(a.length))],
    chance: (p: number) => Number(next() % 10_000n) < p * 10_000,
    bytes: (n: number) => Uint8Array.from({ length: n }, () => Number(next() & 0xffn)),
  };
}

type Secret = { a: bigint; b: bigint; w: number; salt: Uint8Array; owner: PublicKey; entangle: { world: PublicKey; index: number } | null };

run(`stateful fuzz of the full instruction surface (seed ${SEED}, ${STEPS} steps)`, () => {
  it("no step breaks an invariant or hits a bug-class error", () => {
    const r = rng(SEED);
    const c = new Chain();
    const admin = c.wallet(5_000_000n * ONE);
    const users = Array.from({ length: 6 }, () => c.wallet(400_000n * ONE));
    const keeper = c.wallet(0n);
    const agents = Array.from({ length: 2 }, () => Keypair.generate());
    for (const a of agents) c.svm.airdrop(a.publicKey, 10_000_000_000n);
    const all = [admin, ...users, keeper];
    const l: Ledger = { rewardFunded: 0n, players: all.map((k) => k.publicKey), worlds: [], swaps: [] };
    const moduleOf = new Map<string, PublicKey>();
    const hostOf = new Map<string, PublicKey>();
    const architectOf = new Map<string, Keypair>();
    const secrets = new Map<string, Secret>();
    const permits: { owner: Keypair; agent: Keypair }[] = [];
    const key = (w: PublicKey, i: number) => `${w.toBase58()}:${i}`;
    const addWorld = (w: PublicKey, module: PublicKey, architect: Keypair | null, host: PublicKey | null) => {
      l.worlds.push(w); c.tokenAccounts.add(c.pda.worldVault(w).toBase58()); moduleOf.set(w.toBase58(), module);
      if (architect) architectOf.set(w.toBase58(), architect);
      if (host) hostOf.set(w.toBase58(), host);
    };

    // ---- setup: a classic law, a quantum law; an architect world, a quantum architect world, a neutral world
    c.send([c.rx.initialize(c.upgradeAuthority.publicKey, admin.publicKey, P)], [c.upgradeAuthority]);
    c.send([c.rx.fundRewardPool(admin.publicKey, 500_000n * ONE)], [admin]); l.rewardFunded += 500_000n * ONE;
    const conway = PHYSICS_PRESETS[0], foam = PHYSICS_PRESETS.find((x) => x.qAmp > 0)!;
    c.send([c.rx.registerModule(admin.publicKey, 0n, conway.birth, conway.survive, conway.royaltyBps, conway.name)], [admin]);
    c.send([c.rx.registerModule(users[5].publicKey, 1n, foam.birth, foam.survive, foam.royaltyBps, foam.name, foam)], [users[5]]);
    const classic = c.pda.module(0n), quantum = c.pda.module(1n);
    for (const [k, m, name] of [[users[0], classic, "Alpha"], [users[1], quantum, "Qubit"]] as const) {
      const w = c.rx.createRootWorld(k.publicKey, c.config().rootWorlds, m, 500 + r.int(2_500), name, 60_000n * ONE);
      c.send([w.ix], [k]); addWorld(w.world, m, k, null);
    }
    const nw = c.rx.createNeutralWorld(users[2].publicKey, c.config().rootWorlds, quantum, "Nu", 60_000n * ONE);
    c.send([nw.ix], [users[2]]); addWorld(nw.world, quantum, null, null);
    const neutral = nw.world;
    checkInvariants(c, l, "setup");

    const holderOf = (w: PublicKey, i: number) => {
      const t = c.territory(w, i);
      return t && !t.holder.equals(PublicKey.default) ? t : null;
    };
    const kp = (pk: PublicKey | undefined) => (pk ? all.find((k) => k.publicKey.equals(pk)) : undefined);
    /** 75%: the real holder; otherwise a random user (unauthorized attempt). */
    const signerFor = (w: PublicKey, i: number): Keypair => {
      const t = holderOf(w, i);
      return (t && r.chance(0.75) ? kp(t.holder) : undefined) ?? r.pick(users);
    };
    const heldBy = (w: PublicKey) => Array.from({ length: SPOTS }, (_, i) => i).filter((i) => holderOf(w, i));
    /** Mostly a held territory (deep states), sometimes any (validation / attack paths). */
    const spot = (w: PublicKey) => { const h = heldBy(w); return h.length && r.chance(0.85) ? r.pick(h) : r.int(SPOTS); };
    /** Existing superposition PDAs (from commits we attempted). */
    const openSps = () => [...secrets.keys()].map((k) => { const [w, i] = k.split(":"); return [new PublicKey(w), Number(i)] as [PublicKey, number]; })
      .filter(([w, i]) => c.svm.getAccount(c.pda.superposition(w, i))?.data.length);
    const plantOracle = (seed: Uint8Array, owner = ORAO_VRF_ID, forSeed = seed) => {
      const data = oraoFulfilledAccountData(forSeed, r.bytes(64));
      c.svm.setAccount(oraoRandomnessPda(seed), { lamports: Number(c.svm.minimumBalanceForRentExemption(BigInt(data.length))), data, owner, executable: false });
    };

    type Tx = { ixs: TransactionInstruction[]; signers: Keypair[] } | null;
    type Action = [name: string, weight: number, build: () => Tx];
    const actions: Action[] = [
      // ---------------- land (so that the other families have holders to work with)
      ["acquire", 8, () => {
        const w = r.pick(l.worlds), i = r.int(SPOTS), buyer = r.pick(users), t = holderOf(w, i);
        const current = t ? t.price : P.minPrice;
        const newPrice = P.minPrice + r.big(P.minPrice * 20n);
        const claimed = r.chance(0.1) ? r.pick(users).publicKey : t?.holder ?? null;
        return { ixs: [c.rx.acquire(buyer.publicKey, w, i, claimed, current + r.big(current), newPrice, epochTax(newPrice, P.harbergerBps) * (1n + r.big(8n)))], signers: [buyer] };
      }],
      ["tick", 6, () => {
        c.warp(BigInt(P.tickIntervalSlots) - 5n + r.big(20n));
        const w = r.pick(l.worlds);
        return { ixs: [c.rx.tick(keeper.publicKey, w, moduleOf.get(w.toBase58())!, hostOf.get(w.toBase58()) ?? null)], signers: [keeper] };
      }],
      ["plant", 3, () => {
        const w = r.pick(l.worlds), i = spot(w), k = signerFor(w, i);
        return { ixs: [c.rx.plant(k.publicKey, w, i, r.pick(PATTERNS))], signers: [k] };
      }],
      ["collect", 2, () => {
        const w = r.pick(l.worlds), i = spot(w), k = signerFor(w, i);
        return { ixs: [c.rx.collect(k.publicKey, w, i)], signers: [k] };
      }],
      ["withdraw", 2, () => {
        const k = r.pick(all), owed = c.player(k.publicKey)?.claimable ?? 0n;
        return { ixs: [c.rx.withdraw(k.publicKey, r.chance(0.2) ? owed + 1n : r.big(owed + 1n))], signers: [k] };
      }],
      ["settle", 1, () => {
        const w = r.pick(l.worlds), i = r.int(SPOTS), t = holderOf(w, i);
        return t ? { ixs: [c.rx.settle(w, i, t.holder)], signers: [keeper] } : null;
      }],
      ["warp", 1, () => { c.warp(r.big(P.epochSlots / 4n)); return null; }],
      ["epoch", 2, () => {
        const cfg = c.config();
        return c.slot < cfg.epochStartSlot + cfg.params.epochSlots ? null : { ixs: [c.rx.advanceEpoch()], signers: [keeper] };
      }],
      ["claim_world_epoch", 2, () => ({ ixs: [c.rx.claimWorldEpoch(r.pick(l.worlds))], signers: [keeper] })],

      // ---------------- quantum layer
      ["quantum_commit", 4, () => {
        const w = r.pick([neutral, l.worlds[1], ...l.worlds]), i = spot(w), k = signerFor(w, i);
        const s: Secret = { a: r.pick(PATTERNS), b: r.pick(PATTERNS), w: r.int(10_001), salt: r.bytes(32), owner: k.publicKey, entangle: null };
        if (r.chance(0.3)) { // entangle with a territory of the same signer in another world (or someone else's: attack)
          const w2 = r.pick(l.worlds.filter((x) => !x.equals(w))), i2 = r.int(SPOTS);
          s.entangle = { world: w2, index: i2 };
        }
        const cm = commitment(s.a, s.b, s.w, s.salt, k.publicKey.toBytes(), w.toBytes(), i);
        secrets.set(key(w, i), s);
        return { ixs: [c.rx.quantumCommit(k.publicKey, w, i, r.chance(0.05) ? new Uint8Array(32) : cm, s.entangle)], signers: [k] };
      }],
      ["oracle", 4, () => { // ORAO answers (or an attacker plants a forged / foreign answer)
        const open = openSps(); if (!open.length) return null;
        const [w, i] = r.pick(open);
        const sp = c.account(c.pda.superposition(w, i), decodeSuperposition);
        if (!sp || sp.observed) return null;
        const roll = r.int(10);
        if (roll === 0) plantOracle(sp.entropy, Keypair.generate().publicKey);           // forged owner
        else if (roll === 1) plantOracle(sp.entropy, ORAO_VRF_ID, r.bytes(32));        // answer to another seed
        else plantOracle(sp.entropy);
        return null;
      }],
      ["quantum_observe", 4, () => {
        const open = openSps(); if (!open.length) return null;
        const [w, i] = r.pick(open);
        const sp = c.account(c.pda.superposition(w, i), decodeSuperposition);
        if (!sp) return null;
        c.warp(40n);
        const vrf = sp.observed || r.chance(0.1) ? Keypair.generate().publicKey : oraoRandomnessPda(sp.entropy);
        const obs = r.pick([keeper, ...users]);
        return { ixs: [c.rx.quantumObserve(obs.publicKey, w, i, vrf)], signers: [obs] };
      }],
      ["quantum_collapse", 4, () => {
        const open = openSps(); if (!open.length) return null;
        const [w, i] = r.pick(open);
        const sp = c.account(c.pda.superposition(w, i), decodeSuperposition);
        const s = secrets.get(key(w, i));
        if (!sp || !s) return null;
        const owner = kp(sp.owner) ?? r.pick(users);
        const wrong = r.chance(0.1);
        const ent = sp.world2.equals(PublicKey.default) ? null : { world: sp.world2, index: sp.index2 };
        const signer = r.chance(0.1) ? r.pick(users) : owner;
        return { ixs: [c.rx.quantumCollapse(signer.publicKey, w, i, s.a, s.b, wrong ? (s.w + 1) % 10_001 : s.w, s.salt, ent)], signers: [signer] };
      }],
      ["quantum_decohere", 2, () => {
        const open = openSps(); if (!open.length) return null;
        const [w, i] = r.pick(open);
        const sp = c.account(c.pda.superposition(w, i), decodeSuperposition);
        return sp ? { ixs: [c.rx.quantumDecohere(keeper.publicKey, w, i, r.chance(0.1) ? r.pick(users).publicKey : sp.owner)], signers: [keeper] } : null;
      }],

      // ---------------- neutral world SWAP
      ["swap_offer", 4, () => {
        const held = heldBy(neutral);
        if (held.length < 2) return null;
        const a = r.pick(held), b = r.pick(held);
        const k = signerFor(neutral, a);
        if (!l.swaps!.some((s) => s.a === a && s.b === b)) l.swaps!.push({ world: neutral, a, b });
        return { ixs: [c.rx.swapOffer(k.publicKey, neutral, a, b, r.int(10_002), r.big(5_000n * ONE))], signers: [k] };
      }],
      ["swap_accept", 4, () => {
        if (!l.swaps!.length) return null;
        const s = r.pick(l.swaps!), sw = c.account(c.pda.swap(s.world, s.a, s.b), decodeSwap);
        if (!sw) return null;
        const k = (r.chance(0.85) ? kp(sw.acceptor) : undefined) ?? r.pick(users);
        return { ixs: [c.rx.swapAccept(k.publicKey, s.world, s.a, s.b)], signers: [k] };
      }],
      ["swap_oracle", 3, () => {
        if (!l.swaps!.length) return null;
        const s = r.pick(l.swaps!), sw = c.account(c.pda.swap(s.world, s.a, s.b), decodeSwap);
        if (!sw || !sw.accepted) return null;
        if (r.chance(0.15)) plantOracle(sw.vrfSeed, Keypair.generate().publicKey); else plantOracle(sw.vrfSeed);
        return null;
      }],
      ["swap_resolve", 3, () => {
        const acc = l.swaps!.filter((x) => c.account(c.pda.swap(x.world, x.a, x.b), decodeSwap)?.accepted);
        const pool = acc.length && r.chance(0.85) ? acc : l.swaps!;
        if (!pool.length) return null;
        const s = r.pick(pool), sw = c.account(c.pda.swap(s.world, s.a, s.b), decodeSwap);
        if (!sw) return null;
        c.warp(40n);
        return { ixs: [c.rx.swapResolve(keeper.publicKey, s.world, s.a, s.b, sw.offerer, sw.acceptor, oraoRandomnessPda(sw.vrfSeed))], signers: [keeper] };
      }],
      ["swap_cancel", 2, () => {
        if (!l.swaps!.length) return null;
        const s = r.pick(l.swaps!), sw = c.account(c.pda.swap(s.world, s.a, s.b), decodeSwap);
        if (!sw) return null;
        const k = (r.chance(0.6) ? kp(sw.offerer) : undefined) ?? keeper;
        return { ixs: [c.rx.swapCancel(k.publicKey, s.world, s.a, s.b, sw.offerer)], signers: [k] };
      }],

      // ---------------- nested worlds
      ["create_child_world", 2, () => {
        const host = r.pick(l.worlds), i = spot(host), k = signerFor(host, i);
        if (l.worlds.some((w) => w.equals(c.pda.childWorld(host, i)))) return null;
        const m = r.chance(0.5) ? classic : quantum;
        const cw = c.rx.createChildWorld(k.publicKey, host, i, m, r.int(3_500), "Child", 20_000n * ONE + r.big(20_000n * ONE));
        return { ixs: [cw.ix], signers: [k], after: () => addWorld(cw.world, m, k, host) } as Tx & { after: () => void };
      }],
      ["breach", 1, () => {
        const w = r.pick(l.worlds), h = hostOf.get(w.toBase58());
        return { ixs: [c.rx.breach(w, h ?? r.pick(l.worlds))], signers: [keeper] };
      }],
      ["claim_architect", 2, () => {
        const w = r.pick(l.worlds), a = architectOf.get(w.toBase58());
        const k = (a && r.chance(0.8) ? a : undefined) ?? r.pick(users);
        return { ixs: [c.rx.claimArchitect(k.publicKey, w)], signers: [k] };
      }],
      ["claim_module_royalties", 1, () => {
        const [m, author] = r.chance(0.5) ? [classic, admin] : [quantum, users[5]];
        const k = r.chance(0.8) ? author : r.pick(users);
        return { ixs: [c.rx.claimModuleRoyalties(k.publicKey, m)], signers: [k] };
      }],

      // ---------------- rebellion (architect worlds)
      ["start_rebellion", 3, () => {
        const w = r.pick(l.worlds), i = spot(w), k = signerFor(w, i);
        return { ixs: [c.rx.startRebellion(k.publicKey, w, i)], signers: [k] };
      }],
      ["vote_rebellion", 3, () => {
        const w = r.pick(l.worlds), i = spot(w), k = signerFor(w, i);
        return { ixs: [c.rx.voteRebellion(k.publicKey, w, i)], signers: [k] };
      }],
      ["execute_rebellion", 1, () => {
        const w = r.pick(l.worlds), a = c.world(w).architect;
        const ex = r.pick(users);
        return { ixs: [c.rx.executeRebellion(ex.publicKey, w, r.chance(0.9) ? a : r.pick(users).publicKey)], signers: [ex] };
      }],

      // ---------------- AI agents
      ["create_permit", 1, () => {
        const owner = r.pick(users), agent = r.pick(agents);
        const tx: Tx & { after?: () => void } = {
          ixs: [c.rx.createPermit(owner.publicKey, agent.publicKey, r.chance(0.1) ? r.int(8) : 1 + r.int(3), r.chance(0.5) ? PublicKey.default : r.pick(l.worlds),
            r.big(20_000n * ONE), r.big(40_000n * ONE), 1n + r.big(P.epochSlots * 3n))],
          signers: [owner],
          after: () => {
            if (!permits.some((p) => p.owner === owner && p.agent === agent)) permits.push({ owner, agent });
            c.tokenAccounts.add(c.pda.permitVault(c.pda.permit(owner.publicKey, agent.publicKey)).toBase58());
          },
        };
        return tx;
      }],
      ["fund_permit", 2, () => {
        if (!permits.length) return null;
        const p = r.pick(permits);
        return { ixs: [c.rx.fundPermit(p.owner.publicKey, p.agent.publicKey, r.big(30_000n * ONE))], signers: [p.owner] };
      }],
      ["withdraw_permit", 1, () => {
        if (!permits.length) return null;
        const p = r.pick(permits);
        const bal = c.bal(c.pda.permitVault(c.pda.permit(p.owner.publicKey, p.agent.publicKey)));
        return { ixs: [c.rx.withdrawPermit(p.owner.publicKey, p.agent.publicKey, r.chance(0.2) ? bal + 1n : r.big(bal + 1n))], signers: [p.owner] };
      }],
      ["revoke_permit", 1, () => {
        if (!permits.length) return null;
        const p = r.pick(permits);
        return { ixs: [c.rx.revokePermit(p.owner.publicKey, p.agent.publicKey)], signers: [p.owner], after: () => permits.splice(permits.indexOf(p), 1) } as Tx & { after: () => void };
      }],
      ["agent_plant", 3, () => {
        if (!permits.length) return null;
        const p = r.pick(permits), agent = r.chance(0.9) ? p.agent : r.pick(agents);
        const w = r.pick(l.worlds), held = heldBy(w).filter((i) => holderOf(w, i)!.holder.equals(p.owner.publicKey));
        const i = held.length && r.chance(0.8) ? r.pick(held) : r.int(SPOTS);
        return { ixs: [c.rx.agentPlant(agent.publicKey, p.owner.publicKey, w, i, r.pick(PATTERNS))], signers: [agent] };
      }],
      ["agent_acquire", 3, () => {
        if (!permits.length) return null;
        const p = r.pick(permits), agent = r.chance(0.9) ? p.agent : r.pick(agents);
        const pm = c.account(c.pda.permit(p.owner.publicKey, p.agent.publicKey), decodePermit);
        const w = pm && !pm.allowedWorld.equals(PublicKey.default) && r.chance(0.8) ? pm.allowedWorld : r.pick(l.worlds);
        const i = r.int(SPOTS), t = holderOf(w, i);
        const current = t ? t.price : P.minPrice;
        const newPrice = P.minPrice + r.big(P.minPrice * 10n);
        return { ixs: [c.rx.agentAcquire(agent.publicKey, p.owner.publicKey, w, i, t?.holder ?? null, current + r.big(current), newPrice, epochTax(newPrice, P.harbergerBps) * (1n + r.big(4n)))], signers: [agent] };
      }],

      // ---------------- governance
      ["propose", 1, () => {
        const k = r.chance(0.7) ? admin : r.pick(users);
        const action = r.chance(0.5)
          ? { kind: "TreasurySpend" as const, amount: r.big(c.config().treasurySeen + 2n), recipient: ata(r.pick(users).publicKey, c.mint) }
          : { kind: "SetParams" as const, params: P };
        return { ixs: [c.rx.propose(k.publicKey, action)], signers: [k] };
      }],
      ["execute", 1, () => {
        const cfg = c.config();
        if (r.chance(0.5)) c.warp(48n * 3600n * 5n / 2n + 10n, 48n * 3600n + 10n);
        const pend = cfg.pending;
        const recipient = pend.kind === "TreasurySpend" ? pend.recipient : undefined;
        return { ixs: [c.rx.execute(admin.publicKey, r.chance(0.9) ? cfg.pendingNonce : cfg.pendingNonce + 1n, recipient)], signers: [admin] };
      }],
      ["cancel", 1, () => ({ ixs: [c.rx.cancel(admin.publicKey)], signers: [admin] })],
      ["pause", 1, () => {
        const paused = c.config().paused;
        // pause briefly: the next pause action (or the 50% auto-resume below) lifts it
        const k = r.chance(0.9) ? admin : r.pick(users);
        return { ixs: [c.rx.setPause(k.publicKey, !paused)], signers: [k] };
      }],
    ];
    const total = actions.reduce((a, x) => a + x[1], 0);
    const stats = new Map<string, { ok: number; rejected: number }>();
    const reasons = new Map<string, number>(); // "action: code" → count (printed; guides generator tuning)

    for (let step = 0; step < STEPS; step++) {
      if (c.config().paused && r.chance(0.5)) c.send([c.rx.setPause(admin.publicKey, false)], [admin]);
      let roll = r.int(total), k = 0;
      while (roll >= actions[k][1]) roll -= actions[k++][1];
      const [name, , build] = actions[k];
      const tx = build() as (Tx & { after?: () => void }) | null;
      if (!tx) continue;
      const st = stats.get(name) ?? { ok: 0, rejected: 0 }; stats.set(name, st);
      trace(`#${step} ${name}`);
      try {
        c.send(tx.ixs, tx.signers);
        st.ok++;
        tx.after?.();
      } catch (e) {
        if (!(e instanceof ChainError)) throw e;
        st.rejected++;
        const why = `${name}: ${e.code.split("\n")[0].slice(0, 60)}`; reasons.set(why, (reasons.get(why) ?? 0) + 1);
        if (BUG.test(e.code) || e.logs.some((x) => BUG.test(x))) {
          throw new Error(`step ${step} ${name}: bug-class failure ${e.code}\n${e.logs.slice(-15).join("\n")}`);
        }
      }
      checkInvariants(c, l, `step ${step} ${name}`);
    }

    const summary = [...stats.entries()].map(([n, s]) => `${n} ${s.ok}/${s.ok + s.rejected}`).join(", ");
    console.log(`surface fuzz seed ${SEED}: ${summary}`);
    console.log(`rejections: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join("; ")}`);
    // the walk must reach deep states, not just bounce off validation (asserted for the
    // pinned default seed; random nightly seeds only report coverage)
    if (!process.env.FUZZ_SEED) for (const n of ["acquire", "swap_accept", "quantum_collapse", "quantum_commit", "quantum_observe", "swap_offer", "create_permit", "agent_plant", "create_child_world", "vote_rebellion"]) {
      expect(stats.get(n)?.ok ?? 0, `${n} never succeeded (${summary})`).toBeGreaterThan(0);
    }
  }, Math.max(600_000, STEPS * 1_000)); // ~1 s per step budget: long nightly walks must not time out
});
