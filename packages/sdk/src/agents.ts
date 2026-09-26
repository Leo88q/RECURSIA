// AI inhabitants. Deterministic, heuristic + evolutionary — no LLM, no
// external text input, so there is no prompt-injection surface (#71–#74).
// On-chain they act only through bounded AgentPermits (#75).
import { ONE, TERRITORIES } from "./constants.js";
import { epochTax } from "./economy.js";
import { GameModel, isQuantum, type MWorld } from "./model.js";
import { blockPattern, PATTERNS, scoreBlockPattern } from "./sim.js";

export type Personality = "gardener" | "expansionist" | "speculator" | "demiurge";

export interface AgentGenome {
  /** willingness to spend (0..1) */ aggression: number;
  /** multiplier on value estimate when self-assessing price */ greed: number;
  /** evolved pattern library (8x8 bitmasks) */ library: bigint[];
  /** fitness score accumulated this generation of evolution */ fitness: number;
}

export class Rng {
  constructor(private s: number) { if (!s) this.s = 0x9e3779b9; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 0x100000000; }
  int(n: number) { return Math.floor(this.next() * n); }
  pick<T>(a: readonly T[]) { return a[this.int(a.length)]; }
  u32() { this.next(); return this.s; }
  big64() { return (BigInt(Math.floor(this.next() * 2 ** 32)) << 32n) | BigInt(Math.floor(this.next() * 2 ** 32)); }
}

export function mutatePattern(p: bigint, rng: Rng, flips = 3): bigint {
  for (let i = 0; i < flips; i++) p ^= 1n << BigInt(rng.int(64));
  return p;
}

/**
 * Score a pattern: live cells inside territory `idx` after `gens` generations.
 * Quantum worlds cannot be simulated exactly before the entropy exists, so the
 * score is a Monte-Carlo mean over `samples` hypothetical futures — AI agents
 * face the same uncertainty as humans.
 */
export function evaluatePattern(world: MWorld, idx: number, pattern: bigint, gens = 8, rng?: Rng, samples = 3): number {
  if (!isQuantum(world)) return scoreBlockPattern(world.grid, world.birth, world.survive, idx, pattern, gens, 2);
  const r = rng ?? new Rng(0x5eed);
  let total = 0;
  const q = { qBirth: world.qBirth, qSurvive: world.qSurvive, amp: world.qAmp, seed: [0n, 0n, 0n, 0n] };
  const sampler = () => r.u32();
  for (let k = 0; k < samples; k++) total += scoreBlockPattern(world.grid, world.birth, world.survive, idx, pattern, gens, 2, q, 0n, sampler);
  return total / samples;
}

interface QuantumSecret { world: string; index: number; a: bigint; b: bigint; weight: number; salt: Uint8Array }

export class AIAgent {
  genome: AgentGenome;
  readonly rng: Rng;
  /** Preimages of this agent's open superpositions (off-chain memory). */
  readonly secrets = new Map<string, QuantumSecret>();
  /**
   * @param owner when set, the agent acts through an AgentPermit on behalf of
   *   `owner`: it spends only the permit vault, territories go to the owner.
   */
  constructor(readonly id: string, readonly personality: Personality, seed: number, readonly owner?: string) {
    this.rng = new Rng(seed);
    this.genome = {
      aggression: 0.3 + this.rng.next() * 0.6,
      greed: 1.1 + this.rng.next() * 1.4,
      library: Object.values(PATTERNS).concat([this.rng.big64() & this.rng.big64()]),
      fitness: 0,
    };
  }

  /** Estimated value of a territory: expected emission + host income. */
  valueOf(m: GameModel, w: MWorld, idx: number): bigint {
    const alive = BigInt(w.alive[idx] + 1);
    const hostBonus = w.territories[idx].childWorld ? 40n * ONE : 0n;
    return m.params.minPrice + alive * ONE / 2n + hostBonus;
  }

  act(m: GameModel): string[] {
    const log: string[] = [];
    const holderId = this.owner ?? this.id;
    const permit = this.owner ? m.permits.get(`${this.owner}:${this.id}`) : undefined;
    const me = this.owner ? undefined : m.players.get(this.id);
    if (!me && !permit) return log;
    const worlds = [...m.worlds.values()];
    if (!worlds.length) return log;
    const wallet = () => (permit ? permit.vault : me!.wallet);
    const budget = wallet();
    const opts = this.owner ? { agentOwner: this.owner } : {};
    const mine: Array<[MWorld, number]> = [];
    for (const w of worlds) w.territories.forEach((t, i) => { if (t.holder === holderId && (!this.owner || t.agent)) mine.push([w, i]); });

    // 1) keep deposits healthy, withdraw earnings (own-wallet agents only;
    //    permit agents are scoped to plant/acquire by design)
    if (me) for (const [w, i] of mine) {
      const t = w.territories[i];
      const need = epochTax(t.price, m.params.harbergerBps) * 2n;
      if (t.deposit < need && me.wallet > need) { this.try(() => m.topUp(this.id, w.id, i, need - t.deposit), log); }
      if (w.pending[i] > 0n) this.try(() => { const a = m.collect(this.id, w.id, i); this.genome.fitness += Number(a / ONE); }, log);
    }
    if (me && me.claimable > 0n) this.try(() => m.withdraw(this.id, me.claimable), log);

    // 2) acquire: pick best value/price opportunity
    const maxOwned = this.personality === "speculator" ? 10 : this.personality === "expansionist" ? 8 : 5;
    if (mine.length < maxOwned && this.rng.next() < this.genome.aggression) {
      let best: { w: MWorld; i: number; ratio: number; price: bigint } | null = null;
      for (let k = 0; k < 24; k++) {
        const w = this.rng.pick(worlds);
        const i = this.rng.int(TERRITORIES);
        const t = w.territories[i];
        if (t.holder === holderId) continue;
        const { price } = m.quote(w.id, i);
        const value = this.valueOf(m, w, i);
        const ratio = Number(value * 1000n / (price + 1n)) / 1000;
        const adj = this.personality === "expansionist" && mine.some(([mw, mi]) => mw.id === w.id && Math.abs(mi - i) <= 9) ? ratio * 1.5 : ratio;
        if (!best || adj > best.ratio) best = { w, i, ratio: adj, price };
      }
      if (best && best.ratio > (this.personality === "speculator" ? 1.05 : 0.8)) {
        const value = this.valueOf(m, best.w, best.i);
        let newPrice = BigInt(Math.floor(Number(value) * this.genome.greed));
        if (newPrice < m.params.minPrice) newPrice = m.params.minPrice;
        const deposit = epochTax(newPrice, m.params.harbergerBps) * 3n;
        if (best.price + deposit < budget / 2n) {
          if (permit && newPrice > permit.maxPrice) newPrice = permit.maxPrice > m.params.minPrice ? permit.maxPrice : m.params.minPrice;
          const dep = epochTax(newPrice, m.params.harbergerBps) * 3n;
          this.try(() => m.acquire(this.id, best!.w.id, best!.i, best!.price, newPrice, permit ? dep : deposit, opts), log);
        }
      }
    }

    // 3) plant: evolutionary search over the pattern library (≤2 blocks / turn)
    let planted = 0;
    for (const [w, i] of mine) {
      if (planted >= 2) break;
      if (m.canPlant(holderId, w.id, i) !== null) continue;
      if (w.alive[i] > 18 && this.personality !== "expansionist") continue; // healthy, leave it
      if (wallet() < m.params.plantCost * 4n) break;
      const candidates = [...this.genome.library];
      candidates.push(mutatePattern(this.rng.pick(this.genome.library), this.rng));
      candidates.push(mutatePattern(blockPattern(w.grid, i) | this.rng.pick(this.genome.library), this.rng, 2));
      const scored = candidates.map((c) => ({ c, s: evaluatePattern(w, i, c, 8, this.rng) })).sort((x, y) => y.s - x.s);
      const bestP = scored[0].c, bestS = scored[0].s;
      // 3b) quantum hedge: in quantum worlds, commit a superposition of the two
      //     best candidates instead of a plain plant (own-wallet agents only).
      if (me && isQuantum(w) && scored.length > 1 && bestS > w.alive[i] * 4 && this.rng.next() < this.quantumAppetite()
        && m.canQuantumCommit(this.id, w.id, i) === null) {
        const a = bestP, b = scored[1].c;
        const weight = Math.max(500, Math.min(9_500, Math.round((10_000 * scored[0].s) / (scored[0].s + scored[1].s + 1e-9))));
        const salt = new Uint8Array(32);
        for (let k = 0; k < 32; k++) salt[k] = this.rng.int(256);
        this.try(() => {
          m.quantumCommit(this.id, w.id, i, m.commitFor(this.id, w.id, i, a, b, weight, salt));
          this.secrets.set(`${w.id}:${i}`, { world: w.id, index: i, a, b, weight, salt });
        }, log);
        planted++;
        continue;
      }
      if (bestS > w.alive[i] * 4) {
        this.try(() => m.plant(this.id, w.id, i, bestP, opts), log);
        planted++;
        // evolution: successful mutants join the library, weakest dropped
        if (!this.genome.library.includes(bestP)) {
          this.genome.library.push(bestP);
          if (this.genome.library.length > 12) this.genome.library.splice(this.rng.int(this.genome.library.length - 1), 1);
        }
      }
    }

    // 3c) quantum settlement: reveal own measured states; act as an observer
    //     (bounty) for anybody's superposition that is ready to be measured.
    if (me) this.settleQuantum(m, log);

    // 4) demiurge spawns universes in thriving territories
    if (me && this.personality === "demiurge" && me.wallet > m.params.worldCreateFee * 3n) {
      const host = mine.find(([w, i]) => !w.territories[i].childWorld && w.alive[i] > 8 && w.depth < 4);
      if (host && this.rng.next() < 0.2) {
        const [w, i] = host;
        const mod = this.rng.int(m.modules.length);
        this.try(() => m.createChildWorld(this.id, w.id, i, `${NAMES[this.rng.int(NAMES.length)]}-${w.depth + 1}`, mod, 1000 + this.rng.int(1500), 400n * ONE), log);
      }
    }

    // 5) rebellion instinct: exploited inhabitants rise up
    if (me) for (const [w, i] of mine) {
      if (!w.architect || w.architect === this.id || w.liberated) continue;
      if (!m.rebellionActive(w) && w.architectFeeBps >= 2000 && this.rng.next() < 0.05) this.try(() => m.startRebellion(this.id, w.id, i), log);
      else if (m.rebellionActive(w) && w.territories[i].votedRebellion !== w.rebellionId) this.try(() => m.voteRebellion(this.id, w.id, i), log);
      if (m.canExecuteRebellion(w)) this.try(() => m.executeRebellion(w.id), log);
    }
    return log;
  }

  private quantumAppetite() {
    return this.personality === "speculator" ? 0.6 : this.personality === "demiurge" ? 0.45 : this.personality === "expansionist" ? 0.3 : 0.2;
  }

  private settleQuantum(m: GameModel, log: string[]) {
    for (const [key, sp] of m.superpositions) {
      if (m.canObserve(sp.world, sp.index) === null && this.rng.next() < 0.5) this.try(() => m.quantumObserve(this.id, sp.world, sp.index), log);
      const mine = this.secrets.get(key);
      if (mine && sp.owner === this.id && sp.observed) {
        // Rational: the stake refund dominates any single-block outcome, so reveal.
        this.try(() => m.quantumCollapse(this.id, sp.world, sp.index, mine.a, mine.b, mine.weight, mine.salt), log);
        this.secrets.delete(key);
      } else if (m.canDecohere(sp.world, sp.index) === null) {
        this.try(() => m.quantumDecohere(this.id, sp.world, sp.index), log);
      }
    }
    for (const k of [...this.secrets.keys()]) if (!m.superpositions.has(k)) this.secrets.delete(k);
  }

  private try(f: () => unknown, log: string[]) {
    try { f(); } catch (e) { log.push(`${this.id}: ${(e as Error).message}`); }
  }
}

export const NAMES = ["Эхо", "Гнозис", "Фрактал", "Сомниум", "Ноосфера", "Лимб", "Акаша", "Палимпсест", "Кенома", "Плерома", "Мираж", "Узел"];
