// Reference model of the on-chain program (same rules, same math), used for:
//  * the client sandbox / spectator mode,
//  * economic Monte-Carlo simulation (checklist #54, #58),
//  * property tests & AI agent planning.
// Invariants are asserted after every operation (checklist #49, #53).
import {
  BREACH_POPULATION, BREACH_RESONANCE, DEFAULT_PARAMS, MAX_ARCHITECT_FEE_BPS, MAX_DEPTH, MAX_PRICE, ONE,
  PLANT_COOLDOWN_TICKS, PRICE_CHANGE_COOLDOWN_SLOTS, REBELLION_COOLDOWN_SLOTS, REBELLION_MIN_VOTES,
  REBELLION_THRESHOLD_BPS, REWARD_POOL_BPS, TERRITORIES, TOTAL_SUPPLY, TREASURY_BPS, type Params,
} from "./constants.js";
import { bpsFloor, distribute, epochTax, harbergerDue, splitTick, worldEmission } from "./economy.js";
import { bigbang, GLIDER, orBlock, population, stepN, territoryCounts, writeBlock, type Grid } from "./sim.js";

export class GameError extends Error {}
const req = (c: unknown, m: string): asserts c => { if (!c) throw new GameError(m); };

export interface MTerritory { holder: string | null; price: bigint; deposit: bigint; lastTaxSlot: number; lastPriceChange: number; nextPlantTick: number; acquiredSlot: number; votedRebellion: number; agent: boolean; childWorld: string | null }
export interface MModule { id: number; author: string; name: string; birth: number; survive: number; royaltyBps: number; accrued: bigint; totalEarned: bigint; worldsUsing: number }
export interface MWorld {
  id: string; name: string; parent: string | null; parentTerritory: number; depth: number; architect: string | null; architectFeeBps: number;
  module: number; birth: number; survive: number; grid: Grid; generation: number; tickCount: number; lastTickSlot: number;
  energy: bigint; rewardsReserved: bigint; deposits: bigint; architectAccrued: bigint; vault: bigint;
  alive: number[]; pending: bigint[]; territories: MTerritory[];
  epochId: number; burnCur: bigint; scoresCur: number[]; prevEpochId: number; burnPrev: bigint; scoresPrev: number[]; prevClaimed: boolean;
  resonance: number; children: string[]; rebellionId: number; rebellionVotes: number; rebellionDeadline: number; lastRebellionSlot: number; liberated: boolean; totalBurned: bigint;
  history: number[];
}
export interface MPlayer { id: string; wallet: bigint; claimable: bigint; totalEarned: bigint; isAgent: boolean; spentFees: bigint }
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
  rewardPool: bigint; treasury: bigint; claims = 0n; distribution: bigint; totalBurned = 0n; totalEmitted = 0n;
  curEpoch = 1; epochStart = 0; curTotalBurn = 0n; prevTotalBurn = 0n; prevEmission = 0n; prevClaimed = 0n;
  events: GameEvent[] = [];
  paused = false;

  constructor(params: Params = DEFAULT_PARAMS) {
    this.params = params;
    this.rewardPool = bpsFloor(TOTAL_SUPPLY, REWARD_POOL_BPS);
    this.treasury = bpsFloor(TOTAL_SUPPLY, TREASURY_BPS);
    this.distribution = TOTAL_SUPPLY - this.rewardPool - this.treasury;
  }

  private log(kind: string, text: string, world?: string) {
    this.events.push({ slot: this.slot, kind, text, world });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // --------------------------------------------------------------- players
  addPlayer(id: string, airdrop: bigint, isAgent = false): MPlayer {
    req(this.distribution >= airdrop, "distribution exhausted");
    this.distribution -= airdrop;
    const p: MPlayer = { id, wallet: airdrop, claimable: 0n, totalEarned: 0n, isAgent, spentFees: 0n };
    this.players.set(id, p);
    return p;
  }
  private pl(id: string) { const p = this.players.get(id); req(p, "unknown player"); return p; }
  private spend(id: string, amount: bigint) { const p = this.pl(id); req(p.wallet >= amount, "insufficient funds"); p.wallet -= amount; }
  private burn(amount: bigint) { this.totalBurned += amount; }

  withdraw(id: string, amount: bigint) {
    const p = this.pl(id);
    req(amount > 0n && p.claimable >= amount, "nothing to claim");
    p.claimable -= amount; this.claims -= amount; p.wallet += amount;
    this.check();
  }

  // --------------------------------------------------------------- modules
  registerModule(author: string, name: string, birth: number, survive: number, royaltyBps: number): number {
    req((birth & 1) === 0 && birth !== 0 && birth <= 0x1ff && survive <= 0x1ff, "invalid rule");
    req(royaltyBps <= 500, "royalty too high");
    const fee = this.params.moduleRegisterFee;
    req(this.pl(author).wallet >= fee, "insufficient funds");
    this.spend(author, fee);
    const burn = bpsFloor(fee, this.params.feeBurnBps);
    this.burn(burn); this.treasury += fee - burn;
    this.pl(author).spentFees += fee;
    const id = this.modules.length;
    this.modules.push({ id, author, name, birth, survive, royaltyBps, accrued: 0n, totalEarned: 0n, worldsUsing: 0 });
    this.log("module", `${author} опубликовал законы физики «${name}»`);
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
    const keyBytes = new TextEncoder().encode(id.padEnd(32, "\0")).slice(0, 32);
    const grid = bigbang(keyBytes);
    const w: MWorld = {
      id, name, parent: parent?.id ?? null, parentTerritory, depth: parent ? parent.depth + 1 : 0, architect, architectFeeBps: feeBps,
      module: moduleId, birth: m.birth, survive: m.survive, grid, generation: 0, tickCount: 0, lastTickSlot: this.slot,
      energy: 0n, rewardsReserved: 0n, deposits: 0n, architectAccrued: 0n, vault: 0n,
      alive: territoryCounts(grid), pending: new Array(TERRITORIES).fill(0n),
      territories: Array.from({ length: TERRITORIES }, () => ({ holder: null, price: 0n, deposit: 0n, lastTaxSlot: 0, lastPriceChange: 0, nextPlantTick: 0, acquiredSlot: 0, votedRebellion: 0, agent: false, childWorld: null })),
      epochId: this.curEpoch, burnCur: 0n, scoresCur: new Array(TERRITORIES).fill(0), prevEpochId: this.curEpoch - 1, burnPrev: 0n, scoresPrev: new Array(TERRITORIES).fill(0), prevClaimed: true,
      resonance: 0, children: [], rebellionId: 0, rebellionVotes: 0, rebellionDeadline: 0, lastRebellionSlot: 0, liberated: false, totalBurned: 0n,
      history: [population(grid)],
    };
    m.worldsUsing++;
    this.worlds.set(id, w);
    return w;
  }

  private payCreation(who: string) {
    const fee = this.params.worldCreateFee;
    this.spend(who, fee);
    const burn = bpsFloor(fee, this.params.feeBurnBps);
    this.burn(burn); this.treasury += fee - burn;
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
      w.prevEpochId = w.epochId; w.burnPrev = w.burnCur; w.scoresPrev = w.scoresCur; w.prevClaimed = false;
    } else {
      w.prevEpochId = this.curEpoch - 1; w.burnPrev = 0n; w.scoresPrev = new Array(TERRITORIES).fill(0); w.prevClaimed = true;
    }
    w.epochId = this.curEpoch; w.burnCur = 0n; w.scoresCur = new Array(TERRITORIES).fill(0);
  }

  private recordBurn(w: MWorld, amount: bigint) {
    w.burnCur += amount; w.totalBurned += amount; this.curTotalBurn += amount; this.burn(amount);
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
    w.grid = stepN(w.grid, w.birth, w.survive, p.gensPerTick);
    w.alive = territoryCounts(w.grid);
    for (let i = 0; i < TERRITORIES; i++) w.scoresCur[i] += w.alive[i];
    w.generation += p.gensPerTick; w.tickCount++; w.lastTickSlot = this.slot;
    const pop = population(w.grid);
    w.history.push(pop); if (w.history.length > 240) w.history.shift();
    if (host && pop >= BREACH_POPULATION) w.resonance = Math.min(BREACH_RESONANCE, w.resonance + 1);
    this.recordBurn(w, s.burn);
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
    const emission = this.curTotalBurn === 0n ? 0n : bpsFloor(this.rewardPool, this.params.emissionRateBps);
    this.prevTotalBurn = this.curTotalBurn; this.prevEmission = emission; this.prevClaimed = 0n;
    this.curTotalBurn = 0n; this.curEpoch++; this.epochStart = this.slot;
    this.log("epoch", `Эпоха ${this.curEpoch - 1} закрыта: сожжено ${fmtT(this.prevTotalBurn)}, эмиссия ${fmtT(emission)}`);
  }
  claimWorldEpoch(id: string): bigint {
    const w = this.world(id);
    this.rollEpoch(w);
    req(!w.prevClaimed && w.prevEpochId + 1 === this.curEpoch, "claim window");
    const reward = worldEmission(this.prevEmission, this.prevTotalBurn, w.burnPrev, this.params.rebateCapBps, this.prevClaimed);
    w.prevClaimed = true;
    req(reward > 0n, "nothing to claim");
    const owned = w.territories.map((t) => !!t.holder);
    const { shares, rest } = distribute(reward, w.scoresPrev, owned);
    shares.forEach((s, i) => { if (s > 0n) { w.pending[i] += s; w.rewardsReserved += s; } });
    w.energy += rest;
    this.prevClaimed += reward; this.totalEmitted += reward;
    this.rewardPool -= reward; w.vault += reward;
    this.check();
    return reward;
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
    this.recordBurn(w, cost);
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
  circulating(): bigint {
    let v = this.rewardPool + this.treasury + this.claims + this.distribution;
    for (const p of this.players.values()) v += p.wallet;
    for (const w of this.worlds.values()) v += w.vault;
    for (const p of this.permits.values()) v += p.vault;
    return v;
  }

  /** total_supply == all balances + burned; each vault covers its ledgers. */
  check() {
    const sum = this.circulating() + this.totalBurned;
    if (sum !== TOTAL_SUPPLY) throw new Error(`supply invariant broken: ${sum} != ${TOTAL_SUPPLY}`);
    for (const w of this.worlds.values()) {
      const need = w.energy + w.rewardsReserved + w.deposits + w.architectAccrued;
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

export const fmtT = (v: bigint) => {
  const whole = v / ONE; const frac = (v % ONE) / 10_000n;
  return `${whole.toLocaleString("ru-RU")}${frac ? "," + frac.toString().padStart(2, "0") : ""} RCR`;
};
