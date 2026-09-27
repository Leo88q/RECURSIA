// Reference model of the on-chain program (same rules, same math), used for:
//  * the client sandbox / spectator mode,
//  * economic Monte-Carlo simulation (checklist #54, #58),
//  * property tests & AI agent planning.
// Invariants are asserted after every operation (checklist #49, #53).
import {
  BREACH_POPULATION, BREACH_RESONANCE, DEFAULT_PARAMS, MAX_ARCHITECT_FEE_BPS, MAX_DEPTH, MAX_PRICE, ONE,
  PLANT_COOLDOWN_TICKS, PRICE_CHANGE_COOLDOWN_SLOTS, REBELLION_COOLDOWN_SLOTS, REBELLION_MIN_VOTES,
  REBELLION_THRESHOLD_BPS, SEASON_EPOCHS, SEASON_RANK_BPS, SEASON_SHARE_BPS, SEASON_TOP, SKR_SUPPLY_APPROX,
  SPONSOR_CAP_BPS, SPONSOR_RATE_BPS, TERRITORIES, type Params,
} from "./constants.js";
import {
  bpsFloor, distribute, epochTax, harbergerDue, leaderboardInsert, seasonPrize, splitSpend, splitTick, worldEmission, worldSponsor,
  type LeaderEntry,
} from "./economy.js";
import { bigbang, GLIDER, orBlock, population, stepNQ, swapBlocks, territoryCounts, writeBlock, type Grid } from "./sim.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  collapse as qCollapse, commitment as qCommitment, neighbour, quantumRuleError, quantumSeed,
  QUANTUM_BOUNTY_DIV, QUANTUM_DELAY_SLOTS, QUANTUM_REARM_PENALTY_BPS, QUANTUM_REVEAL_SLOTS, QUANTUM_STAKE_MULT, SLOT_HASHES_MAX,
  SWAP_BOUNTY_DIV, SWAP_OFFER_TTL_SLOTS, swapRoll,
} from "./quantum.js";

/** Deterministic 32-byte identity for model actors / worlds (stands in for a pubkey). */
export const idBytes = (id: string) => sha256(new TextEncoder().encode(`recursia:id:${id}`));
const u64le = (v: number | bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };

export class GameError extends Error {}
function req(c: unknown, m: string): asserts c { if (!c) throw new GameError(m); }

export interface MTerritory { holder: string | null; price: bigint; deposit: bigint; lastTaxSlot: number; lastPriceChange: number; nextPlantTick: number; acquiredSlot: number; votedRebellion: number; agent: boolean; childWorld: string | null }
export interface MModule { id: number; author: string; name: string; birth: number; survive: number; royaltyBps: number; accrued: bigint; totalEarned: bigint; worldsUsing: number; qBirth: number; qSurvive: number; qAmp: number }
export interface MSuperposition {
  owner: string; world: string; index: number; world2: string | null; index2: number; commitment: Uint8Array;
  commitSlot: number; targetSlot: number; observed: boolean; observedSlot: number; entropy: Uint8Array | null;
  revealDeadline: number; stake: bigint; rearms: number;
}
export interface MWorld {
  id: string; name: string; parent: string | null; parentTerritory: number; depth: number; architect: string | null; architectFeeBps: number;
  module: number; birth: number; survive: number; grid: Grid; generation: number; tickCount: number; lastTickSlot: number;
  energy: bigint; rewardsReserved: bigint; deposits: bigint; architectAccrued: bigint; vault: bigint;
  alive: number[]; pending: bigint[]; territories: MTerritory[];
  epochId: number; sinkCur: bigint; scoresCur: number[]; prevEpochId: number; sinkPrev: bigint; scoresPrev: number[]; prevClaimed: boolean;
  resonance: number; children: string[]; rebellionId: number; rebellionVotes: number; rebellionDeadline: number; lastRebellionSlot: number; liberated: boolean; totalSunk: bigint;
  history: number[];
  // quantum layer
  key: Uint8Array; qBirth: number; qSurvive: number; qAmp: number; entropy: Uint8Array | null; quantumEscrow: bigint; superpositions: number;
  /** Neutral quantum world: no architect, SWAP market enabled. */
  neutral: boolean;
  /** Live-cell score on owned territories (sponsor weight). */
  scoreOwnedCur: bigint; scoreOwnedPrev: bigint;
}
/** Probabilistic block exchange in a neutral world (mirror of the `QuantumSwap` account). */
export interface MSwap {
  key: string; world: string; offerer: string; acceptor: string; indexA: number; indexB: number; weightBps: number;
  premium: bigint; bounty: bigint; createdSlot: number; expirySlot: number; accepted: boolean; targetSlot: number; rearms: number;
}
export interface MPlayer {
  id: string; wallet: bigint; claimable: bigint; totalEarned: bigint; isAgent: boolean; spentFees: bigint;
  /** Season the points belong to; points = SKR collected from life (rewards + host tax). */
  seasonId: number; seasonPoints: bigint;
}
export interface MSeasonResult { id: number; top: LeaderEntry<string>[]; prizes: bigint[]; claimed: boolean[] }
const emptyTop = (): LeaderEntry<string>[] => Array.from({ length: SEASON_TOP }, () => ({ player: "", points: 0n }));
export interface MPermit { owner: string; agent: string; vault: bigint; maxSpendPerEpoch: bigint; maxPrice: bigint; spent: bigint; spendEpoch: number; expirySlot: number; scope: number }

export type GameEvent = { slot: number; kind: string; text: string; world?: string };

export class GameModel {
  params: Params;
  slot = 0;
  worlds = new Map<string, MWorld>();
  players = new Map<string, MPlayer>();
  modules: MModule[] = [];
  permits = new Map<string, MPermit>();
  rootCount = 0;
  // global token ledgers
  /** SKR is external: `supply` is the whole SKR supply, `distribution` = SKR held outside the game. */
  readonly supply: bigint;
  rewardPool: bigint; treasury: bigint; claims = 0n; distribution: bigint; totalSunk = 0n; totalEmitted = 0n;
  curEpoch = 1; epochStart = 0; curTotalSink = 0n; prevTotalSink = 0n; prevEmission = 0n; prevClaimed = 0n;
  // sponsor pool (mirror of Config sponsor fields)
  sponsorPool = 0n; curTotalScore = 0n; prevTotalScore = 0n; prevSponsorBudget = 0n; prevSponsorClaimed = 0n; totalSponsored = 0n;
  // seasons
  seasonPool = 0n; treasurySeen = 0n; seasonId = 1; seasonStartEpoch = 1; totalSeasonFunded = 0n; totalSeasonPaid = 0n;
  seasonTop: LeaderEntry<string>[] = emptyTop();
  lastSeason: MSeasonResult | null = null;
  events: GameEvent[] = [];
  paused = false;
  superpositions = new Map<string, MSuperposition>();
  swaps = new Map<string, MSwap>();
  /** Salt of the simulated cluster's slot hashes (sandbox); fixed = reproducible runs. */
  chainSalt: Uint8Array = new Uint8Array(32);

  /**
   * @param opts.supply   total SKR in existence (default ≈ 10.62B)
   * @param opts.poolSeed SKR the studio puts into the reward pool at launch
   *                      (`fund_reward_pool`); the treasury starts empty.
   */
  constructor(params: Params = DEFAULT_PARAMS, opts: { supply?: bigint; poolSeed?: bigint } = {}) {
    this.params = params;
    this.supply = opts.supply ?? SKR_SUPPLY_APPROX;
    this.rewardPool = opts.poolSeed ?? 0n;
    req(this.rewardPool >= 0n && this.rewardPool <= this.supply, "pool seed");
    this.treasury = 0n;
    this.distribution = this.supply - this.rewardPool;
  }

  private log(kind: string, text: string, world?: string) {
    this.events.push({ slot: this.slot, kind, text, world });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // --------------------------------------------------------------- players
  addPlayer(id: string, airdrop: bigint, isAgent = false): MPlayer {
    req(this.distribution >= airdrop, "distribution exhausted");
    this.distribution -= airdrop;
    const p: MPlayer = { id, wallet: airdrop, claimable: 0n, totalEarned: 0n, isAgent, spentFees: 0n, seasonId: 0, seasonPoints: 0n };
    this.players.set(id, p);
    return p;
  }
  private pl(id: string) { const p = this.players.get(id); req(p, "unknown player"); return p; }
  private spend(id: string, amount: bigint) { const p = this.pl(id); req(p.wallet >= amount, "insufficient funds"); p.wallet -= amount; }
  /**
   * A player spend (nothing is burned — SKR is not ours to burn):
   * `studioBps` → studio treasury, the rest → player reward pool. Only the pool
   * part is the world's emission weight. Returns the pool part.
   */
  private sink(w: MWorld | null, amount: bigint, studioBps: number): bigint {
    const { studio, pool } = splitSpend(amount, studioBps);
    this.treasury += studio; this.rewardPool += pool; this.totalSunk += pool;
    if (w) { w.sinkCur += pool; w.totalSunk += pool; this.curTotalSink += pool; }
    return pool;
  }
  /** Anyone may top up the reward pool (mirror of `fund_reward_pool`). */
  fundRewardPool(id: string, amount: bigint) {
    req(amount > 0n, "zero amount");
    this.spend(id, amount); this.rewardPool += amount;
    this.check();
  }

  /** Anyone may fund the sponsor pool (mirror of `fund_sponsor_pool`). */
  fundSponsorPool(id: string, amount: bigint) {
    req(amount > 0n, "zero amount");
    this.spend(id, amount); this.sponsorPool += amount;
    this.log("sponsor", `${id} пополнил спонсорский пул на ${fmtT(amount)}: награды за живые клетки выросли`);
    this.check();
  }

  withdraw(id: string, amount: bigint) {
    const p = this.pl(id);
    req(amount > 0n && p.claimable >= amount, "nothing to claim");
    p.claimable -= amount; this.claims -= amount; p.wallet += amount;
    this.check();
  }

  // --------------------------------------------------------------- modules
  registerModule(author: string, name: string, birth: number, survive: number, royaltyBps: number, q: { qBirth: number; qSurvive: number; qAmp: number } = { qBirth: 0, qSurvive: 0, qAmp: 0 }): number {
    req((birth & 1) === 0 && birth !== 0 && birth <= 0x1ff && survive <= 0x1ff, "invalid rule");
    const qErr = quantumRuleError(birth, survive, q.qBirth, q.qSurvive, q.qAmp); req(!qErr, qErr ?? "");
    req(royaltyBps <= 500, "royalty too high");
    const fee = this.params.moduleRegisterFee;
    req(this.pl(author).wallet >= fee, "insufficient funds");
    this.spend(author, fee);
    this.sink(null, fee, this.params.protocolBps);
    this.pl(author).spentFees += fee;
    const id = this.modules.length;
    this.modules.push({ id, author, name, birth, survive, royaltyBps, accrued: 0n, totalEarned: 0n, worldsUsing: 0, qBirth: q.qBirth, qSurvive: q.qSurvive, qAmp: q.qAmp });
    this.log("module", `${author} опубликовал законы физики «${name}»${q.qAmp ? " ⚛ (квантовые)" : ""}`);
    this.check();
    return id;
  }
  claimModuleRoyalties(author: string, moduleId: number) {
    const m = this.modules[moduleId]; req(m && m.author === author, "not author"); req(m.accrued > 0n, "nothing");
    const p = this.pl(author); p.claimable += m.accrued; p.totalEarned += m.accrued; m.totalEarned += m.accrued; m.accrued = 0n;
  }

  // --------------------------------------------------------------- worlds
  private newWorld(id: string, name: string, parent: MWorld | null, parentTerritory: number, architect: string, feeBps: number, moduleId: number): MWorld {
    const m = this.modules[moduleId]; req(m, "unknown module");
    const keyBytes = idBytes(id);
    const grid = bigbang(keyBytes);
    const w: MWorld = {
      id, name, parent: parent?.id ?? null, parentTerritory, depth: parent ? parent.depth + 1 : 0, architect, architectFeeBps: feeBps,
      module: moduleId, birth: m.birth, survive: m.survive, grid, generation: 0, tickCount: 0, lastTickSlot: this.slot,
      energy: 0n, rewardsReserved: 0n, deposits: 0n, architectAccrued: 0n, vault: 0n,
      alive: territoryCounts(grid), pending: new Array(TERRITORIES).fill(0n),
      territories: Array.from({ length: TERRITORIES }, () => ({ holder: null, price: 0n, deposit: 0n, lastTaxSlot: 0, lastPriceChange: 0, nextPlantTick: 0, acquiredSlot: 0, votedRebellion: 0, agent: false, childWorld: null })),
      epochId: this.curEpoch, sinkCur: 0n, scoresCur: new Array(TERRITORIES).fill(0), prevEpochId: this.curEpoch - 1, sinkPrev: 0n, scoresPrev: new Array(TERRITORIES).fill(0), prevClaimed: true,
      resonance: 0, children: [], rebellionId: 0, rebellionVotes: 0, rebellionDeadline: 0, lastRebellionSlot: 0, liberated: false, totalSunk: 0n,
      history: [population(grid)],
      key: keyBytes, qBirth: m.qBirth, qSurvive: m.qSurvive, qAmp: m.qAmp, entropy: null, quantumEscrow: 0n, superpositions: 0,
      neutral: false, scoreOwnedCur: 0n, scoreOwnedPrev: 0n,
    };
    m.worldsUsing++;
    this.worlds.set(id, w);
    return w;
  }

  private payCreation(who: string) {
    const fee = this.params.worldCreateFee;
    this.spend(who, fee);
    this.sink(null, fee, this.params.protocolBps);
    this.pl(who).spentFees += fee;
  }

  createRootWorld(architect: string, name: string, moduleId: number, feeBps: number, initialEnergy: bigint): MWorld {
    req(!this.paused, "paused");
    req(feeBps <= MAX_ARCHITECT_FEE_BPS, "fee too high");
    req(this.modules[moduleId], "unknown module");
    req(this.pl(architect).wallet >= this.params.worldCreateFee + initialEnergy, "insufficient funds");
    this.payCreation(architect);
    this.spend(architect, initialEnergy);
    const w = this.newWorld(`root-${this.rootCount++}`, name, null, 0, architect, feeBps, moduleId);
    w.energy = initialEnergy; w.vault = initialEnergy;
    this.log("world", `${architect} создал вселенную «${name}»`, w.id);
    this.check();
    return w;
  }

  /** Neutral quantum world: creator pays but gets no rights; module must be quantum. */
  createNeutralWorld(creator: string, name: string, moduleId: number, initialEnergy: bigint): MWorld {
    req(!this.paused, "paused");
    const m = this.modules[moduleId]; req(m, "unknown module");
    req(isQuantum(m), "neutral worlds need quantum physics");
    req(this.pl(creator).wallet >= this.params.worldCreateFee + initialEnergy, "insufficient funds");
    this.payCreation(creator);
    this.spend(creator, initialEnergy);
    const w = this.newWorld(`root-${this.rootCount++}`, name, null, 0, creator, 0, moduleId);
    w.architect = null; w.liberated = true; w.neutral = true;
    w.energy = initialEnergy; w.vault = initialEnergy;
    this.log("world", `${creator} открыл нейтральный квантовый мир «${name}» — без архитектора, с рынком SWAP`, w.id);
    this.check();
    return w;
  }

  createChildWorld(architect: string, hostId: string, idx: number, name: string, moduleId: number, feeBps: number, initialEnergy: bigint): MWorld {
    req(!this.paused, "paused");
    const host = this.world(hostId);
    const t = host.territories[idx];
    req(t.holder === architect, "not holder");
    req(!t.childWorld, "already hosts a universe");
    req(host.depth + 1 <= MAX_DEPTH, "max depth");
    req(feeBps <= MAX_ARCHITECT_FEE_BPS, "fee too high");
    req(!this.wouldForeclose(host, idx), "deposit exhausted");
    req(this.modules[moduleId], "unknown module");
    req(this.pl(architect).wallet >= this.params.worldCreateFee + initialEnergy, "insufficient funds");
    this.accrueTax(host, idx);
    this.payCreation(architect);
    this.spend(architect, initialEnergy);
    const w = this.newWorld(`${hostId}/${idx}`, name, host, idx, architect, feeBps, moduleId);
    w.energy = initialEnergy; w.vault = initialEnergy;
    t.childWorld = w.id; host.children.push(w.id);
    this.log("world", `${architect} запустил симуляцию «${name}» внутри клетки #${idx} мира «${host.name}» (уровень ${w.depth})`, w.id);
    this.check();
    return w;
  }

  world(id: string) { const w = this.worlds.get(id); req(w, "unknown world"); return w; }

  fundWorld(funder: string, id: string, amount: bigint) {
    const w = this.world(id); req(amount > 0n, "zero");
    this.spend(funder, amount); w.energy += amount; w.vault += amount; this.check();
  }

  private rollEpoch(w: MWorld) {
    if (w.epochId >= this.curEpoch) return;
    if (w.epochId + 1 === this.curEpoch) {
      w.prevEpochId = w.epochId; w.sinkPrev = w.sinkCur; w.scoresPrev = w.scoresCur; w.prevClaimed = false;
      w.scoreOwnedPrev = w.scoreOwnedCur;
    } else {
      w.prevEpochId = this.curEpoch - 1; w.sinkPrev = 0n; w.scoresPrev = new Array(TERRITORIES).fill(0); w.prevClaimed = true;
      w.scoreOwnedPrev = 0n;
    }
    w.epochId = this.curEpoch; w.sinkCur = 0n; w.scoresCur = new Array(TERRITORIES).fill(0); w.scoreOwnedCur = 0n;
  }


  canTick(id: string): string | null {
    const w = this.world(id);
    if (this.paused) return "paused";
    if (this.slot < w.lastTickSlot + Number(this.params.tickIntervalSlots)) return "too early";
    if (w.energy < this.params.tickCost) return "no energy";
    if (w.parent) { const h = this.world(w.parent); if (h.alive[w.parentTerritory] === 0) return "dormant"; }
    return null;
  }

  tick(cranker: string, id: string) {
    const w = this.world(id);
    const why = this.canTick(id); req(!why, why ?? "");
    const p = this.params;
    const m = this.modules[w.module];
    const host = w.parent ? this.world(w.parent) : null;
    const s = splitTick(p.tickCost, p.crankerBps, p.protocolBps, p.hostBps, m.royaltyBps, !!host);
    this.rollEpoch(w);
    w.energy -= p.tickCost; w.vault -= p.tickCost;
    if (isQuantum(w)) {
      // same schedule as the program: hash of slot (last tick + interval − 1)
      const hash = this.slotHash(w.lastTickSlot + Number(p.tickIntervalSlots) - 1);
      w.entropy = hash;
      const q = { qBirth: w.qBirth, qSurvive: w.qSurvive, amp: w.qAmp, seed: quantumSeed(hash, w.key, BigInt(w.generation)) };
      w.grid = stepNQ(w.grid, w.birth, w.survive, q, BigInt(w.generation), p.gensPerTick);
    } else {
      w.grid = stepNQ(w.grid, w.birth, w.survive, null, 0n, p.gensPerTick);
    }
    w.alive = territoryCounts(w.grid);
    let owned = 0n;
    for (let i = 0; i < TERRITORIES; i++) { w.scoresCur[i] += w.alive[i]; if (w.territories[i].holder) owned += BigInt(w.alive[i]); }
    w.scoreOwnedCur += owned; this.curTotalScore += owned;
    w.generation += p.gensPerTick; w.tickCount++; w.lastTickSlot = this.slot;
    const pop = population(w.grid);
    w.history.push(pop); if (w.history.length > 240) w.history.shift();
    if (host && pop >= BREACH_POPULATION) w.resonance = Math.min(BREACH_RESONANCE, w.resonance + 1);
    this.sink(w, s.pool, 0);
    m.accrued += s.royalty; this.claims += s.royalty;
    this.pl(cranker).wallet += s.cranker;
    this.treasury += s.protocol;
    if (host) {
      const idx = w.parentTerritory;
      if (host.territories[idx].holder) { host.pending[idx] += s.host; host.rewardsReserved += s.host; }
      else host.energy += s.host;
      host.vault += s.host;
    }
    this.check();
  }

  // --------------------------------------------------------------- epochs
  canAdvanceEpoch() { return this.slot >= this.epochStart + Number(this.params.epochSlots); }
  advanceEpoch() {
    req(this.canAdvanceEpoch(), "epoch not over");
    const emission = this.curTotalSink === 0n ? 0n : bpsFloor(this.rewardPool, this.params.emissionRateBps);
    const sponsorBudget = this.curTotalScore === 0n || this.curTotalSink === 0n ? 0n : bpsFloor(this.sponsorPool, SPONSOR_RATE_BPS);
    this.prevTotalSink = this.curTotalSink; this.prevEmission = emission; this.prevClaimed = 0n;
    this.prevTotalScore = this.curTotalScore; this.prevSponsorBudget = sponsorBudget; this.prevSponsorClaimed = 0n; this.curTotalScore = 0n;
    this.curTotalSink = 0n; this.curEpoch++; this.epochStart = this.slot;
    // season share of new studio inflow (treasury → season pool)
    const inflow = this.treasury > this.treasurySeen ? this.treasury - this.treasurySeen : 0n;
    const share = bpsFloor(inflow, SEASON_SHARE_BPS);
    this.treasury -= share; this.seasonPool += share; this.treasurySeen = this.treasury; this.totalSeasonFunded += share;
    if (this.curEpoch - this.seasonStartEpoch >= SEASON_EPOCHS) this.closeSeason();
    this.log("epoch", `Эпоха ${this.curEpoch - 1} закрыта: в пул наград пришло ${fmtT(this.prevTotalSink)}, к раздаче ${fmtT(emission)} (мир получает ≤ ${this.params.rebateCapBps / 100}% своего вклада в пул)`);
  }
  claimWorldEpoch(id: string): bigint {
    const w = this.world(id);
    this.rollEpoch(w);
    req(!w.prevClaimed && w.prevEpochId + 1 === this.curEpoch, "claim window");
    const reward = worldEmission(this.prevEmission, this.prevTotalSink, w.sinkPrev, this.params.rebateCapBps, this.prevClaimed);
    const sponsor = worldSponsor(this.prevSponsorBudget, this.prevTotalScore, w.scoreOwnedPrev, w.sinkPrev, SPONSOR_CAP_BPS, this.prevSponsorClaimed);
    const total = reward + sponsor;
    req(total > 0n, "nothing to claim");
    w.prevClaimed = true;
    const owned = w.territories.map((t) => !!t.holder);
    const { shares, rest } = distribute(total, w.scoresPrev, owned);
    shares.forEach((s, i) => { if (s > 0n) { w.pending[i] += s; w.rewardsReserved += s; } });
    w.energy += rest;
    this.prevClaimed += reward; this.totalEmitted += reward;
    this.prevSponsorClaimed += sponsor; this.totalSponsored += sponsor;
    this.rewardPool -= reward; this.sponsorPool -= sponsor; w.vault += total;
    this.check();
    return total;
  }

  // --------------------------------------------------------------- seasons
  private closeSeason() {
    const prizes = this.seasonTop.map((e, r) => (e.player ? seasonPrize(this.seasonPool, SEASON_RANK_BPS[r], e.points) : 0n));
    this.lastSeason = { id: this.seasonId, top: this.seasonTop, prizes, claimed: prizes.map(() => false) };
    const total = prizes.reduce((a, b) => a + b, 0n);
    this.log("season", `Сезон ${this.seasonId} закрыт: призовой фонд ${fmtT(this.seasonPool)}, призы ${fmtT(total)}${this.seasonTop[0].player ? `, победитель — ${this.seasonTop[0].player}` : ""}`);
    this.seasonTop = emptyTop(); this.seasonId++; this.seasonStartEpoch = this.curEpoch;
  }
  /** Points of `id` in the current season (0 if none yet). */
  seasonPointsOf(id: string) { const p = this.pl(id); return p.seasonId === this.seasonId ? p.seasonPoints : 0n; }
  /** Permissionless: put a player's points on the top-10 (mirror of `season_submit`). */
  seasonSubmit(id: string): boolean {
    const p = this.pl(id);
    req(p.seasonId === this.seasonId && p.seasonPoints > 0n, "no season points");
    return leaderboardInsert(this.seasonTop, { player: id, points: p.seasonPoints }, (k) => k === "", (a, b) => a === b);
  }
  /** Permissionless: credit rank's prize of the last closed season (mirror of `claim_season_prize`). */
  claimSeasonPrize(rank: number): bigint {
    const s = this.lastSeason;
    req(s && rank >= 0 && rank < SEASON_TOP && s.top[rank].player && !s.claimed[rank] && s.prizes[rank] > 0n, "no prize");
    const amount = s.prizes[rank]; const p = this.pl(s.top[rank].player);
    s.claimed[rank] = true;
    p.claimable += amount; p.totalEarned += amount; this.claims += amount;
    this.seasonPool -= amount; this.totalSeasonPaid += amount;
    this.log("season", `${p.id} получил приз сезона ${s.id} за ${rank + 1}-е место: ${fmtT(amount)}`);
    this.check();
    return amount;
  }

  // --------------------------------------------------------------- territories
  /** Pure: would accruing tax now foreclose this territory? */
  wouldForeclose(w: MWorld, idx: number): boolean {
    const t = w.territories[idx];
    if (!t.holder) return false;
    const due = harbergerDue(t.price, this.params.harbergerBps, BigInt(Math.max(0, this.slot - t.lastTaxSlot)), this.params.epochSlots);
    return due >= t.deposit;
  }

  private permitCheck(owner: string, agent: string, world: string, amount: bigint, scopeBit: number): MPermit {
    const p = this.permits.get(`${owner}:${agent}`); req(p, "no permit");
    req(this.slot < p.expirySlot, "permit expired");
    req((p.scope & scopeBit) !== 0, "permit scope");
    const spent = p.spendEpoch !== this.curEpoch ? 0n : p.spent;
    req(spent + amount <= p.maxSpendPerEpoch, "permit limit");
    req(p.vault >= amount, "permit vault empty");
    void world;
    return p;
  }

  private accrueTax(w: MWorld, idx: number): "paid" | "foreclose" {
    const t = w.territories[idx];
    if (!t.holder) return "paid";
    const due = harbergerDue(t.price, this.params.harbergerBps, BigInt(Math.max(0, this.slot - t.lastTaxSlot)), this.params.epochSlots);
    const paid = due < t.deposit ? due : t.deposit;
    t.deposit -= paid; w.deposits -= paid;
    const fee = w.architect ? bpsFloor(paid, w.architectFeeBps) : 0n;
    w.architectAccrued += fee; w.energy += paid - fee;
    t.lastTaxSlot = this.slot;
    return due > paid || t.deposit === 0n ? "foreclose" : "paid";
  }

  private release(w: MWorld, idx: number) {
    const t = w.territories[idx];
    const old = this.pl(t.holder!);
    const pending = w.pending[idx];
    w.pending[idx] = 0n; w.rewardsReserved -= pending; w.deposits -= t.deposit;
    const out = pending + t.deposit;
    w.vault -= out; this.claims += out;
    old.claimable += out; old.totalEarned += pending;
    t.deposit = 0n;
    if (t.votedRebellion && t.votedRebellion === w.rebellionId && this.rebellionActive(w)) w.rebellionVotes = Math.max(0, w.rebellionVotes - 1);
    t.votedRebellion = 0; t.holder = null; t.agent = false; t.price = 0n;
  }

  settle(id: string, idx: number) {
    const w = this.world(id);
    const t = w.territories[idx];
    req(t.holder, "not held");
    if (this.accrueTax(w, idx) === "foreclose") {
      this.log("foreclose", `${t.holder} потерял клетку #${idx} в «${w.name}» — налог не оплачен`, w.id);
      this.release(w, idx);
    }
    this.check();
  }

  quote(id: string, idx: number): { price: bigint; held: boolean } {
    const w = this.world(id); const t = w.territories[idx];
    return t.holder ? { price: t.price, held: true } : { price: this.params.minPrice, held: false };
  }

  acquire(buyer: string, id: string, idx: number, maxPrice: bigint, newPrice: bigint, deposit: bigint, opts: { agentOwner?: string } = {}): bigint {
    req(!this.paused, "paused");
    req(idx >= 0 && idx < TERRITORIES, "bad territory");
    const w = this.world(id);
    const t = w.territories[idx];
    const p = this.params;
    const newHolder = opts.agentOwner ?? buyer;
    req(newPrice >= p.minPrice && newPrice <= MAX_PRICE, "bad price");
    req(deposit >= epochTax(newPrice, p.harbergerBps), "deposit too small");
    // ---- checks first (the on-chain tx is atomic; the model must be too)
    const foreclose = !!t.holder && this.wouldForeclose(w, idx);
    const heldAfter = !!t.holder && !foreclose;
    const expected = heldAfter ? t.price : p.minPrice;
    req(expected <= maxPrice, "price slippage");
    if (heldAfter) req(t.holder !== newHolder, "self-buy");
    if (opts.agentOwner) {
      const permit = this.permitCheck(opts.agentOwner, buyer, id, expected + deposit, 2);
      req(maxPrice <= permit.maxPrice, "permit price limit");
    } else req(this.pl(buyer).wallet >= expected + deposit, "insufficient funds");
    let paySource = (amount: bigint) => this.spend(buyer, amount);
    if (opts.agentOwner) {
      const permit = this.permits.get(`${opts.agentOwner}:${buyer}`)!;
      paySource = (amount: bigint) => { permit.vault -= amount; };
    }
    // ---- effects
    if (t.holder && this.accrueTax(w, idx) === "foreclose") {
      this.log("foreclose", `${t.holder} потерял клетку #${idx} — налог не оплачен`, w.id);
      this.release(w, idx);
    }
    let paid: bigint;
    let seller: string | null = null;
    if (t.holder) {
      req(t.holder !== newHolder, "self-buy");
      paid = t.price; req(paid <= maxPrice, "price slippage");
      seller = t.holder;
      paySource(paid); this.claims += paid; this.pl(seller).claimable += paid;
      this.release(w, idx);
    } else {
      paid = p.minPrice; req(paid <= maxPrice, "price slippage");
      paySource(paid); w.energy += paid; w.vault += paid;
    }
    paySource(deposit); w.deposits += deposit; w.vault += deposit;
    Object.assign(t, { holder: newHolder, price: newPrice, deposit, lastTaxSlot: this.slot, lastPriceChange: this.slot, nextPlantTick: w.tickCount, acquiredSlot: this.slot, votedRebellion: 0, agent: !!opts.agentOwner });
    if (opts.agentOwner) this.chargePermit(opts.agentOwner, buyer, id, paid + deposit, 2);
    this.log("acquire", `${newHolder}${opts.agentOwner ? " (ИИ)" : ""} ${seller ? `выкупил у ${seller}` : "занял"} клетку #${idx} в «${w.name}» за ${fmtT(paid)}`, w.id);
    this.check();
    return paid + deposit;
  }

  setPrice(holder: string, id: string, idx: number, newPrice: bigint) {
    const w = this.world(id); const t = w.territories[idx];
    req(t.holder === holder, "not holder");
    req(!this.wouldForeclose(w, idx), "deposit exhausted");
    req(this.slot >= t.lastPriceChange + PRICE_CHANGE_COOLDOWN_SLOTS, "cooldown");
    req(newPrice >= this.params.minPrice && newPrice <= MAX_PRICE, "bad price");
    this.accrueTax(w, idx);
    req(t.deposit >= epochTax(newPrice, this.params.harbergerBps), "deposit too small");
    t.price = newPrice; t.lastPriceChange = this.slot;
    this.check();
  }

  topUp(holder: string, id: string, idx: number, amount: bigint) {
    const w = this.world(id); const t = w.territories[idx];
    req(t.holder === holder, "not holder");
    req(amount > 0n, "zero");
    req(!this.wouldForeclose(w, idx), "deposit exhausted");
    req(this.pl(holder).wallet >= amount, "insufficient funds");
    this.accrueTax(w, idx);
    this.spend(holder, amount); t.deposit += amount; w.deposits += amount; w.vault += amount;
    this.check();
  }

  collect(holder: string, id: string, idx: number): bigint {
    const w = this.world(id); const t = w.territories[idx];
    req(t.holder === holder, "not holder");
    req(!this.wouldForeclose(w, idx), "deposit exhausted");
    const amt = w.pending[idx]; req(amt > 0n, "nothing");
    this.accrueTax(w, idx);
    w.pending[idx] = 0n; w.rewardsReserved -= amt; w.vault -= amt; this.claims += amt;
    const p = this.pl(holder); p.claimable += amt; p.totalEarned += amt;
    if (p.seasonId !== this.seasonId) { p.seasonId = this.seasonId; p.seasonPoints = 0n; }
    p.seasonPoints += amt;
    this.check();
    return amt;
  }

  canPlant(holder: string, id: string, idx: number): string | null {
    const w = this.world(id); const t = w.territories[idx];
    if (t.holder !== holder) return "not holder";
    if (w.tickCount < t.nextPlantTick) return "cooldown";
    return null;
  }

  plant(actor: string, id: string, idx: number, pattern: bigint, opts: { agentOwner?: string } = {}) {
    req(!this.paused, "paused");
    const w = this.world(id); const t = w.territories[idx];
    const holder = opts.agentOwner ?? actor;
    req(t.holder === holder, "not holder");
    req(!this.wouldForeclose(w, idx), "deposit exhausted");
    req(w.tickCount >= t.nextPlantTick, "cooldown");
    const cost = this.params.plantCost;
    if (opts.agentOwner) this.permitCheck(opts.agentOwner, actor, id, cost, 1);
    else req(this.pl(actor).wallet >= cost, "insufficient funds");
    this.accrueTax(w, idx);
    if (opts.agentOwner) {
      this.chargePermit(opts.agentOwner, actor, id, cost, 1);
      this.permits.get(`${opts.agentOwner}:${actor}`)!.vault -= cost;
    } else this.spend(actor, cost);
    t.nextPlantTick = w.tickCount + PLANT_COOLDOWN_TICKS;
    this.rollEpoch(w);
    writeBlock(w.grid, idx, pattern);
    w.alive = territoryCounts(w.grid);
    this.sink(w, cost, this.params.protocolBps);
    this.check();
  }

  // --------------------------------------------------------------- breach & rebellion
  breach(childId: string) {
    const c = this.world(childId); req(c.parent, "root");
    req(c.resonance >= BREACH_RESONANCE, "no resonance");
    c.resonance = 0;
    const h = this.world(c.parent);
    orBlock(h.grid, c.parentTerritory, GLIDER);
    h.alive = territoryCounts(h.grid);
    this.log("breach", `ПРОРЫВ: жизнь из «${c.name}» просочилась в клетку #${c.parentTerritory} мира «${h.name}»`, h.id);
  }

  rebellionActive(w: MWorld) { return w.rebellionId > 0 && this.slot <= w.rebellionDeadline && !w.liberated; }

  startRebellion(holder: string, id: string, idx: number) {
    const w = this.world(id); const t = w.territories[idx];
    req(t.holder === holder, "not holder");
    req(w.architect && !w.liberated, "no architect");
    req(!this.rebellionActive(w), "already active");
    req(w.lastRebellionSlot === 0 || this.slot >= w.lastRebellionSlot + REBELLION_COOLDOWN_SLOTS, "cooldown");
    req(holder !== w.architect, "architect can't rebel");
    req(t.acquiredSlot < this.slot, "too fresh");
    w.rebellionId++; w.rebellionVotes = 1; w.rebellionDeadline = this.slot + Number(this.params.epochSlots); w.lastRebellionSlot = this.slot;
    t.votedRebellion = w.rebellionId;
    this.log("rebellion", `Восстание в «${w.name}»! ${holder} призывает свергнуть архитектора ${w.architect}`, w.id);
  }

  voteRebellion(holder: string, id: string, idx: number) {
    const w = this.world(id); const t = w.territories[idx];
    req(t.holder === holder, "not holder");
    req(this.rebellionActive(w), "no rebellion");
    req(t.votedRebellion !== w.rebellionId, "already voted");
    req(t.acquiredSlot < w.lastRebellionSlot, "bought after start");
    t.votedRebellion = w.rebellionId; w.rebellionVotes++;
  }

  canExecuteRebellion(w: MWorld) {
    const owned = w.territories.filter((t) => t.holder).length;
    return this.rebellionActive(w) && w.rebellionVotes >= REBELLION_MIN_VOTES && w.rebellionVotes * 10_000 >= owned * REBELLION_THRESHOLD_BPS;
  }

  executeRebellion(id: string) {
    const w = this.world(id);
    req(this.canExecuteRebellion(w), "threshold not met");
    const former = w.architect!;
    const p = this.pl(former);
    p.claimable += w.architectAccrued; p.totalEarned += w.architectAccrued;
    w.vault -= w.architectAccrued; this.claims += w.architectAccrued; w.architectAccrued = 0n;
    w.architect = null; w.architectFeeBps = 0; w.liberated = true; w.rebellionDeadline = this.slot;
    this.log("liberated", `«${w.name}» освобождён: жители свергли архитектора ${former}`, w.id);
    this.check();
  }

  claimArchitect(architect: string, id: string) {
    const w = this.world(id); req(w.architect === architect, "not architect");
    const amt = w.architectAccrued; req(amt > 0n, "nothing");
    w.architectAccrued = 0n; w.vault -= amt; this.claims += amt;
    const p = this.pl(architect); p.claimable += amt; p.totalEarned += amt;
    this.check();
  }

  // --------------------------------------------------------------- AI permits
  createPermit(owner: string, agent: string, fund: bigint, maxSpendPerEpoch: bigint, maxPrice: bigint, durationSlots: number, scope = 3) {
    req(owner !== agent, "agent must differ");
    this.spend(owner, fund);
    this.permits.set(`${owner}:${agent}`, { owner, agent, vault: fund, maxSpendPerEpoch, maxPrice, spent: 0n, spendEpoch: this.curEpoch, expirySlot: this.slot + durationSlots, scope });
  }
  private chargePermit(owner: string, agent: string, _world: string, amount: bigint, scopeBit: number) {
    const p = this.permits.get(`${owner}:${agent}`); req(p, "no permit");
    req(this.slot < p.expirySlot, "permit expired");
    req((p.scope & scopeBit) !== 0, "permit scope");
    if (p.spendEpoch !== this.curEpoch) { p.spendEpoch = this.curEpoch; p.spent = 0n; }
    req(p.spent + amount <= p.maxSpendPerEpoch, "permit limit");
    p.spent += amount;
  }

  // --------------------------------------------------------------- invariants
  // --------------------------------------------------------------- quantum layer
  /** Simulated SlotHashes entry (every slot produced in the model). */
  slotHash(slot: number): Uint8Array {
    return sha256(new Uint8Array([...new TextEncoder().encode("recursia:slot"), ...this.chainSalt, ...u64le(Math.max(0, slot))]));
  }
  superposition(worldId: string, idx: number) { return this.superpositions.get(`${worldId}:${idx}`); }
  quantumStake(entangled: boolean) { return this.params.plantCost * QUANTUM_STAKE_MULT * (entangled ? 2n : 1n); }
  /** Client helper: the commitment exactly as the program computes it. */
  commitFor(owner: string, worldId: string, idx: number, a: bigint, b: bigint, weightBps: number, salt: Uint8Array) {
    return qCommitment(a, b, weightBps, salt, idBytes(owner), this.world(worldId).key, idx);
  }

  canQuantumCommit(holder: string, worldId: string, idx: number, entangle?: { world: string; index: number } | null): string | null {
    const w = this.world(worldId); const t = w.territories[idx];
    if (this.paused) return "paused";
    if (t.holder !== holder) return "not holder";
    if (this.superposition(worldId, idx)) return "already superposed";
    if (w.tickCount < t.nextPlantTick) return "cooldown";
    if (this.wouldForeclose(w, idx)) return "deposit exhausted";
    if (entangle) {
      if (entangle.world === worldId) return "entangle across different worlds";
      const w2 = this.world(entangle.world); const t2 = w2.territories[entangle.index];
      if (t2.holder !== holder) return "not holder";
      if (w2.tickCount < t2.nextPlantTick) return "cooldown";
      if (this.wouldForeclose(w2, entangle.index)) return "deposit exhausted";
    }
    const cost = this.params.plantCost * (entangle ? 2n : 1n) + this.quantumStake(!!entangle);
    if (this.pl(holder).wallet < cost) return "insufficient funds";
    return null;
  }

  quantumCommit(holder: string, worldId: string, idx: number, commitment: Uint8Array, entangle?: { world: string; index: number } | null) {
    const why = this.canQuantumCommit(holder, worldId, idx, entangle); req(!why, why ?? "");
    req(commitment.length === 32 && commitment.some((b) => b !== 0), "commitment");
    const w = this.world(worldId); const t = w.territories[idx];
    const n = entangle ? 2n : 1n;
    const spendAmt = this.params.plantCost * n, stake = this.quantumStake(!!entangle);
    // effects
    this.accrueTax(w, idx); t.nextPlantTick = w.tickCount + PLANT_COOLDOWN_TICKS;
    if (entangle) { const w2 = this.world(entangle.world); this.accrueTax(w2, entangle.index); w2.territories[entangle.index].nextPlantTick = w2.tickCount + PLANT_COOLDOWN_TICKS; }
    this.spend(holder, spendAmt + stake);
    this.rollEpoch(w); this.sink(w, spendAmt, this.params.protocolBps);
    w.quantumEscrow += stake; w.vault += stake; w.superpositions++;
    this.superpositions.set(`${worldId}:${idx}`, {
      owner: holder, world: worldId, index: idx, world2: entangle?.world ?? null, index2: entangle?.index ?? 0, commitment: commitment.slice(),
      commitSlot: this.slot, targetSlot: this.slot + QUANTUM_DELAY_SLOTS, observed: false, observedSlot: 0, entropy: null,
      revealDeadline: 0, stake, rearms: 0,
    });
    this.log("quantum", `${holder} посадил клетку #${idx} мира «${w.name}» в суперпозицию${entangle ? ` (запутана с «${this.world(entangle.world).name}» #${entangle.index})` : ""}`, worldId);
    this.check();
  }

  canObserve(worldId: string, idx: number): string | null {
    const sp = this.superposition(worldId, idx);
    if (!sp) return "no superposition";
    if (sp.observed) return "already observed";
    if (this.slot <= sp.targetSlot) return "not measurable yet";
    return null;
  }

  /** Returns "observed" | "rearmed". Works while paused (settlement). */
  quantumObserve(observer: string, worldId: string, idx: number): "observed" | "rearmed" {
    const why = this.canObserve(worldId, idx); req(!why, why ?? "");
    const sp = this.superposition(worldId, idx)!; const w = this.world(worldId);
    this.pl(observer);
    if (this.slot - sp.targetSlot >= SLOT_HASHES_MAX) {
      const penalty = (sp.stake * QUANTUM_REARM_PENALTY_BPS) / 10_000n;
      sp.stake -= penalty; w.quantumEscrow -= penalty; w.vault -= penalty; this.sink(null, penalty, 0);
      sp.targetSlot = this.slot + QUANTUM_DELAY_SLOTS; sp.rearms++;
      this.log("quantum", `Измерение клетки #${idx} «${w.name}» просрочено — перевзведено, штраф ${fmtT(penalty)} ушёл в пул наград`, worldId);
      this.check();
      return "rearmed";
    }
    const bounty = sp.stake / QUANTUM_BOUNTY_DIV;
    sp.observed = true; sp.observedSlot = this.slot; sp.entropy = this.slotHash(sp.targetSlot);
    sp.revealDeadline = this.slot + QUANTUM_REVEAL_SLOTS;
    sp.stake -= bounty; w.quantumEscrow -= bounty; w.vault -= bounty; this.pl(observer).wallet += bounty;
    this.log("quantum", `👁 ${observer} наблюдал клетку #${idx} «${w.name}»: волновая функция зафиксирована`, worldId);
    this.check();
    return "observed";
  }

  /** Predict the outcome for the owner (who knows the preimage) once observed. */
  previewCollapse(worldId: string, idx: number, weightBps: number) {
    const sp = this.superposition(worldId, idx);
    if (!sp?.observed || !sp.entropy) return null;
    return qCollapse(sp.entropy, sp.commitment, weightBps);
  }

  quantumCollapse(owner: string, worldId: string, idx: number, a: bigint, b: bigint, weightBps: number, salt: Uint8Array) {
    const sp = this.superposition(worldId, idx); req(sp, "no superposition");
    req(sp.owner === owner, "not owner");
    req(sp.observed && sp.entropy, "not observed");
    req(this.slot <= sp.revealDeadline, "reveal window closed");
    req(weightBps >= 0 && weightBps <= 10_000, "weight");
    const expect = qCommitment(a, b, weightBps, salt, idBytes(owner), this.world(worldId).key, idx);
    req(expect.every((v, i) => v === sp.commitment[i]), "commitment mismatch");
    const w = this.world(worldId);
    const c = qCollapse(sp.entropy, sp.commitment, weightBps);
    const [primary, partner] = c.branchA ? [a, b] : [b, a];
    let tunnel: number | null = null;
    if (w.territories[idx].holder === owner) {
      writeBlock(w.grid, idx, primary);
      if (c.tunnel) { tunnel = neighbour(idx, c.tunnelDir); orBlock(w.grid, tunnel, primary); }
      w.alive = territoryCounts(w.grid);
    }
    if (sp.world2) {
      const w2 = this.world(sp.world2);
      if (w2.territories[sp.index2].holder === owner) { writeBlock(w2.grid, sp.index2, partner); w2.alive = territoryCounts(w2.grid); }
    }
    w.quantumEscrow -= sp.stake; w.vault -= sp.stake; w.superpositions--;
    this.pl(owner).wallet += sp.stake;
    this.superpositions.delete(`${worldId}:${idx}`);
    this.log("quantum", `⚛ Коллапс клетки #${idx} «${w.name}» → ветвь ${c.branchA ? "A" : "B"}${tunnel !== null ? `, туннелирование в #${tunnel}` : ""}${sp.world2 ? `; запутанная пара в «${this.world(sp.world2).name}» получила противоположное состояние` : ""}`, worldId);
    this.check();
    return { ...c, tunnelTo: tunnel, pattern: primary };
  }

  canDecohere(worldId: string, idx: number): string | null {
    const sp = this.superposition(worldId, idx);
    if (!sp) return "no superposition";
    if (this.paused) return "paused";
    const expired = sp.observed ? this.slot > sp.revealDeadline : this.slot > sp.targetSlot + QUANTUM_REVEAL_SLOTS;
    return expired ? null : "still coherent";
  }

  quantumDecohere(caller: string, worldId: string, idx: number) {
    const why = this.canDecohere(worldId, idx); req(!why, why ?? "");
    const sp = this.superposition(worldId, idx)!; const w = this.world(worldId);
    this.pl(caller);
    const bounty = sp.stake / QUANTUM_BOUNTY_DIV; const penalty = sp.stake - bounty;
    w.quantumEscrow -= sp.stake; w.vault -= sp.stake; w.superpositions--;
    this.pl(caller).wallet += bounty; this.sink(null, penalty, 0);
    this.superpositions.delete(`${worldId}:${idx}`);
    this.log("quantum", `Декогеренция: клетка #${idx} «${w.name}» не раскрыта вовремя — ${fmtT(penalty)} ушло в пул наград`, worldId);
    this.check();
  }

  // --------------------------------------------------------------- neutral worlds: SWAP market
  swapKey(worldId: string, a: number, b: number) { return `${worldId}:${a}:${b}`; }
  swap(worldId: string, a: number, b: number) { return this.swaps.get(this.swapKey(worldId, a, b)); }
  swapFee() { return this.params.plantCost; }

  canSwapOffer(offerer: string, worldId: string, a: number, b: number, weightBps: number, premium: bigint): string | null {
    const w = this.world(worldId);
    if (this.paused) return "paused";
    if (!w.neutral || !isQuantum(w)) return "not a neutral quantum world";
    if (a === b || a < 0 || b < 0 || a >= TERRITORIES || b >= TERRITORIES) return "bad blocks";
    if (!(weightBps > 0 && weightBps <= 10_000)) return "weight";
    if (premium < 0n) return "premium";
    if (w.territories[a].holder !== offerer) return "not holder";
    const acc = w.territories[b].holder;
    if (!acc) return "target block has no holder";
    if (acc === offerer) return "cannot swap with yourself";
    if (this.swap(worldId, a, b)) return "offer exists";
    if (this.pl(offerer).wallet < this.swapFee() + premium) return "insufficient funds";
    return null;
  }

  swapOffer(offerer: string, worldId: string, a: number, b: number, weightBps: number, premium: bigint): MSwap {
    const why = this.canSwapOffer(offerer, worldId, a, b, weightBps, premium); req(!why, why ?? "");
    const w = this.world(worldId);
    const fee = this.swapFee(); const bounty = fee / SWAP_BOUNTY_DIV; const spendAmt = fee - bounty;
    this.spend(offerer, fee + premium);
    this.pl(offerer).spentFees += fee;
    this.rollEpoch(w); this.sink(w, spendAmt, this.params.protocolBps);
    w.quantumEscrow += premium + bounty; w.vault += premium + bounty;
    const s: MSwap = {
      key: this.swapKey(worldId, a, b), world: worldId, offerer, acceptor: w.territories[b].holder!, indexA: a, indexB: b, weightBps,
      premium, bounty, createdSlot: this.slot, expirySlot: this.slot + SWAP_OFFER_TTL_SLOTS, accepted: false, targetSlot: 0, rearms: 0,
    };
    this.swaps.set(s.key, s);
    this.log("swap", `${offerer} предлагает ${s.acceptor} квантовый SWAP #${a}⇄#${b} в «${w.name}» (p=${(weightBps / 100).toFixed(0)}%, премия ${fmtT(premium)})`, worldId);
    this.check();
    return s;
  }

  canSwapAccept(acceptor: string, worldId: string, a: number, b: number): string | null {
    const s = this.swap(worldId, a, b);
    if (!s) return "no offer";
    if (this.paused) return "paused";
    if (s.acceptor !== acceptor) return "not addressed to you";
    if (s.accepted) return "already accepted";
    if (this.slot > s.expirySlot) return "expired";
    if (this.world(worldId).territories[b].holder !== acceptor) return "not holder";
    if (this.world(worldId).territories[a].holder !== s.offerer) return "offerer lost block A";
    return null;
  }

  swapAccept(acceptor: string, worldId: string, a: number, b: number) {
    const why = this.canSwapAccept(acceptor, worldId, a, b); req(!why, why ?? "");
    const s = this.swap(worldId, a, b)!;
    s.accepted = true; s.targetSlot = this.slot + QUANTUM_DELAY_SLOTS;
    this.log("swap", `${acceptor} принял SWAP #${a}⇄#${b}: исход решит хеш слота ${s.targetSlot}`, worldId);
  }

  canSwapResolve(worldId: string, a: number, b: number): string | null {
    const s = this.swap(worldId, a, b);
    if (!s) return "no offer";
    if (!s.accepted) return "not accepted";
    if (this.slot <= s.targetSlot) return "not measurable yet";
    return null;
  }

  /** Permissionless (works while paused). Returns the outcome. */
  swapResolve(resolver: string, worldId: string, a: number, b: number): "swapped" | "stayed" | "rearmed" {
    const why = this.canSwapResolve(worldId, a, b); req(!why, why ?? "");
    const s = this.swap(worldId, a, b)!; const w = this.world(worldId);
    this.pl(resolver);
    if (this.slot - s.targetSlot >= SLOT_HASHES_MAX) {
      s.targetSlot = this.slot + QUANTUM_DELAY_SLOTS; s.rearms++;
      this.log("swap", `SWAP #${a}⇄#${b}: измерение просрочено — перевзведено`, worldId);
      return "rearmed";
    }
    // Binding on the blocks: a holder change after acceptance does not void it.
    const roll = swapRoll(this.slotHash(s.targetSlot), idBytes(`swap:${s.key}`));
    const swapped = roll < s.weightBps;
    if (swapped) { swapBlocks(w.grid, a, b); w.alive = territoryCounts(w.grid); }
    w.quantumEscrow -= s.premium + s.bounty; w.vault -= s.premium + s.bounty;
    const payee = this.pl(s.acceptor);
    payee.claimable += s.premium; this.claims += s.premium; payee.totalEarned += s.premium;
    this.pl(resolver).wallet += s.bounty;
    this.swaps.delete(s.key);
    this.log("swap", `⇄ SWAP #${a}⇄#${b} в «${w.name}»: ${swapped ? "блоки обменялись" : "остались на местах"} (бросок ${roll} vs ${s.weightBps})`, worldId);
    this.check();
    return swapped ? "swapped" : "stayed";
  }

  canSwapCancel(caller: string, worldId: string, a: number, b: number): string | null {
    const s = this.swap(worldId, a, b);
    if (!s) return "no offer";
    if (s.accepted) return "already accepted";
    if (caller !== s.offerer && this.slot <= s.expirySlot) return "offer still open";
    return null;
  }

  swapCancel(caller: string, worldId: string, a: number, b: number) {
    const why = this.canSwapCancel(caller, worldId, a, b); req(!why, why ?? "");
    const s = this.swap(worldId, a, b)!; const w = this.world(worldId);
    this.pl(caller);
    w.quantumEscrow -= s.premium + s.bounty; w.vault -= s.premium + s.bounty;
    this.pl(s.offerer).claimable += s.premium; this.claims += s.premium;
    this.pl(caller).wallet += s.bounty;
    this.swaps.delete(s.key);
    this.log("swap", `SWAP #${a}⇄#${b} в «${w.name}» отменён`, worldId);
    this.check();
  }

  circulating(): bigint {
    let v = this.rewardPool + this.sponsorPool + this.seasonPool + this.treasury + this.claims + this.distribution;
    for (const p of this.players.values()) v += p.wallet;
    for (const w of this.worlds.values()) v += w.vault;
    for (const p of this.permits.values()) v += p.vault;
    return v;
  }

  /** Exact SKR conservation (nothing is minted or burned); each vault covers its ledgers. */
  check() {
    const sum = this.circulating();
    if (sum !== this.supply) throw new Error(`supply invariant broken: ${sum} != ${this.supply}`);
    for (const w of this.worlds.values()) {
      const need = w.energy + w.rewardsReserved + w.deposits + w.architectAccrued + w.quantumEscrow;
      let esc = 0n; let n = 0;
      for (const sp of this.superpositions.values()) if (sp.world === w.id) { esc += sp.stake; n++; }
      for (const s of this.swaps.values()) if (s.world === w.id) esc += s.premium + s.bounty;
      if (esc !== w.quantumEscrow || n !== w.superpositions) throw new Error(`quantum escrow mismatch in ${w.id}`);
      if (w.vault < need) throw new Error(`vault insolvent in ${w.id}`);
      if (w.rewardsReserved !== w.pending.reduce((a, b) => a + b, 0n)) throw new Error(`pending mismatch in ${w.id}`);
      if (w.deposits !== w.territories.reduce((a, t) => a + t.deposit, 0n)) throw new Error(`deposit mismatch in ${w.id}`);
    }
    let claimable = 0n;
    for (const p of this.players.values()) claimable += p.claimable;
    for (const m of this.modules) claimable += m.accrued;
    if (claimable !== this.claims) throw new Error(`claims vault mismatch ${claimable} != ${this.claims}`);
  }

  advanceSlots(n: number) { this.slot += n; }
}

export const isQuantum = (w: { qAmp: number; qBirth: number; qSurvive: number }) => w.qAmp > 0 && (w.qBirth | w.qSurvive) !== 0;

export const fmtT = (v: bigint) => {
  const whole = v / ONE; const frac = (v % ONE) / 10_000n;
  return `${whole.toLocaleString("ru-RU")}${frac ? "," + frac.toString().padStart(2, "0") : ""} SKR`;
};
