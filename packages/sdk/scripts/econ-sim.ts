/**
 * RECURSIA economic stress simulation (checklist #54/#58: econ sim / invariant tests before mainnet).
 *
 * Runs the *reference model* (bit-exact mirror of the on-chain rules, validated
 * by cross-implementation vectors) through several adversarial scenarios and
 * asserts the economic invariants the design relies on:
 *
 *   I1  SKR conservation: circulating == supply every step (nothing minted / burned)
 *       (GameModel.check() runs after every mutation and throws otherwise)
 *   I2  emission is pool-backed: totalEmitted <= seed + everything paid INTO the pool
 *       (rebate ≤ 100% of a world's own contribution + a capped efficiency share for live
 *       cells, both drawn from the pool; the studio 20% never returns)
 *   I3  self-farming is unprofitable: an actor ticking its own world to farm
 *       emission ends with strictly less than it started with
 *   I4  wash trading is impossible (self-acquire rejected by the program)
 *   I5  the studio earns (protocol fee + module royalties) while players play
 *   I6  reward-pool ledger is exact: pool == seed + pool inflows − emission, never negative
 *   I7  AI agents cannot overspend their permit (per-epoch cap enforced)
 *   I8  quantum withholding is unprofitable: a player who hides unfavourable
 *       collapses (lets them decohere) ends poorer than an honest twin
 *   I9  quantum escrow (superpositions + SWAP premiums/bounties) is fully settled or still open — never leaks
 *   I10 neutral worlds stay neutral: no architect, no architect income, ever
 *   I11 player-authored laws: royalty accrues only to modules that worlds actually run
 *   I12 sponsor pool is exact and bounded: pool == funded − paid, and no world ever got
 *       more sponsor money than it paid into the pool that epoch (Σ ≤ totalSunk)
 *   I13 seasons are exact and bounded: season pool == funded − paid; every prize ≤ 25% of
 *       the winner's own season points (a prize can never exceed what the game already paid)
 *
 * Realism (v2): mixed AI skill (novice / skilled / pro), newcomers joining every epoch,
 * a studio-funded sponsor pool, weekly seasons, and a per-role PnL breakdown.
 *
 * v3: season tournaments (entry fee → top 30%), the efficiency share of emission and
 * "guided" newcomers who heed the client's warnings (dying planting / low deposit).
 * Headline metric: % in profit among players who played ≥ 2 epochs.
 *
 * Usage: npm run econ [-- --quick] [-- --seeds N] [-- --epochs N] [-- --unguided] [-- --no-tournaments]
 */
import { AIAgent, type Personality, type Skill } from "../src/agents.js";
import { DEFAULT_PARAMS, MAX_ARCHITECT_FEE_BPS, ONE, PHYSICS_PRESETS, SEASON_PRIZE_CAP_BPS, SEASON_SHARE_BPS, SEASON_TOP, TOURNAMENT_TOP, type Params } from "../src/constants.js";
import { GameModel } from "../src/model.js";
import { bpsFloor, epochTax } from "../src/economy.js";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const QUICK = flag("quick");
const SEEDS = opt("seeds", QUICK ? 2 : 6);
const EPOCHS = opt("epochs", QUICK ? 8 : 22); // ≥ 8 so at least one 7-epoch season closes
const STEP = 300;
// Calibration flags (what-if experiments): --emission BPS --rebate BPS --protocol BPS --sponsor U --only NAME
const PARAMS: Params = {
  ...DEFAULT_PARAMS, epochSlots: 9_000n,
  emissionRateBps: opt("emission", DEFAULT_PARAMS.emissionRateBps),
  rebateCapBps: opt("rebate", DEFAULT_PARAMS.rebateCapBps),
  protocolBps: opt("protocol", DEFAULT_PARAMS.protocolBps),
};
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const SPONSOR_OVERRIDE = argv.includes("--sponsor") ? BigInt(opt("sponsor", 0)) : null;
/** Scenario amounts are written in price units (plant_cost / 5 = 70 SKR at the default SKR price list). */
const U = PARAMS.plantCost / 5n;

type Scenario = {
  name: string; agents: number; farmer: boolean; whales: number; permitAgents: number; quantum?: boolean; neutral?: boolean;
  /** skill mix for the `agents` (cycled); default all skilled */ skills?: Skill[];
  /** novice newcomers joining at every epoch boundary */ newcomers?: number;
  /** SKR (in U) the studio puts into the sponsor pool at launch */ sponsor?: bigint;
  /** agents enter season tournaments */ tournaments?: boolean;
  /** newcomers heed the client's safety hints */ guided?: boolean;
};
const SCENARIOS: Scenario[] = [
  { name: "baseline", agents: 12, farmer: false, whales: 0, permitAgents: 0 },
  { name: "self-farm attack", agents: 8, farmer: true, whales: 0, permitAgents: 0 },
  { name: "whale pressure", agents: 8, farmer: false, whales: 3, permitAgents: 0 },
  { name: "delegated AI", agents: 6, farmer: false, whales: 0, permitAgents: 6 },
  { name: "thin market", agents: 2, farmer: false, whales: 0, permitAgents: 0 },
  { name: "quantum worlds", agents: 10, farmer: false, whales: 0, permitAgents: 0, quantum: true },
  { name: "neutral + laws", agents: 12, farmer: false, whales: 0, permitAgents: 0, quantum: true, neutral: true },
  { name: "sponsored", agents: 12, farmer: false, whales: 0, permitAgents: 0, sponsor: 20_000n },
  { name: "sponsored farm", agents: 8, farmer: true, whales: 0, permitAgents: 0, sponsor: 20_000n },
  { name: "living economy", agents: 12, farmer: false, whales: 1, permitAgents: 0, quantum: true, skills: ["novice", "skilled", "pro", "novice", "skilled", "pro"], newcomers: 2, sponsor: 20_000n, tournaments: true, guided: true },
];
const NEWCOMER0 = 300n; // U — a newcomer brings ~21k SKR (≈ $400)
const PERS: Personality[] = ["gardener", "expansionist", "speculator", "demiurge"];
const fmt = (v: bigint) => (Number(v / (ONE / 100n)) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

interface Result {
  scenario: string; seed: number; sunk: bigint; emitted: bigint; studio: bigint; worlds: number;
  farmerPnl?: bigint; withholdGap?: bigint; qStats?: string; agentMedianPnl: bigint; agentBestPnl: bigint; permitOverspend: number; failures: string[];
  roles: string; season: string;
}

const median = (a: bigint[]) => (a.length ? a[Math.floor(a.length / 2)] : 0n);
const sortB = (a: bigint[]) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
function roleLine(name: string, pnls: bigint[]): string {
  if (!pnls.length) return "";
  const s = sortB(pnls); const win = s.filter((x) => x > 0n).length;
  return `${name} n=${s.length} med ${fmt(median(s))} best ${fmt(s[s.length - 1])} в плюсе ${Math.round((100 * win) / s.length)}%`;
}

function wealth(m: GameModel, id: string): bigint {
  const p = m.players.get(id)!;
  let w = p.wallet + p.claimable;
  for (const world of m.worlds.values()) {
    world.territories.forEach((t, i) => { if (t.holder === id) w += t.deposit + world.pending[i]; });
    if (world.architect === id) w += world.architectAccrued + world.energy; // energy is sunk, count it generously
  }
  return w;
}

function run(sc: Scenario, seed: number): Result {
  const m = new GameModel(PARAMS);
  const failures: string[] = [];
  const assert = (c: unknown, msg: string) => { if (!c) failures.push(msg); };

  m.addPlayer("studio", 100_000n * U);
  for (const p of PHYSICS_PRESETS) m.registerModule("studio", p.name, p.birth, p.survive, p.royaltyBps, p);
  m.addPlayer("keeper", 0n);
  // studio baseline before any world exists: world-creation fees are studio revenue too
  // (and the season sweep takes 25% of them, so a later baseline would under-count)
  // The studio's own genesis fees (10 preset laws) land in its treasury; 25% of them is swept
  // into the season-1 prize fund at the first epoch — a launch marketing budget, not operating loss.
  const genesisSeason = bpsFloor(m.treasury, SEASON_SHARE_BPS);
  const studio0 = m.treasury + m.players.get("studio")!.wallet - genesisSeason;
  m.addPlayer("founder", 60_000n * U);
  const qMod = (n: string) => PHYSICS_PRESETS.findIndex((p) => p.name === n);
  const worldA = m.createRootWorld("founder", "A", sc.quantum ? qMod("Quantum Foam") : 0, 1_500, 8_000n * U).id;
  m.createRootWorld("founder", "B", sc.quantum ? qMod("Tunnel Life") : 1, 2_500, 6_000n * U);
  const neutralId = sc.neutral ? m.createNeutralWorld("founder", "N", qMod("Tunnel Life"), 8_000n * U).id : "";

  // I8 twins: identical scripted quantum players; one withholds bad outcomes.
  const TWIN0 = 5_000n * U;
  const TWIN_PRICE = 3_000n * U;
  const twins = sc.quantum ? (["honest", "withholder"] as const) : [];
  const secrets = new Map<string, Uint8Array>();
  twins.forEach((id, k) => {
    m.addPlayer(id, TWIN0);
    for (const j of [0, 1]) {
      const idx = 40 + k * 8 + j;
      // High self-assessed price: the twins' cells must not be bought out by AI
      // (a buyout would measure Harberger luck, not withholding). Both twins
      // pay the same tax, so the comparison stays symmetric.
      try { m.acquire(id, worldA, idx, 10n ** 12n, TWIN_PRICE, epochTax(TWIN_PRICE, PARAMS.harbergerBps) * 4n); } catch (e) { failures.push(`I8 setup: ${(e as Error).message}`); }
    }
  });
  const GOOD = 0x0000_1824_2418_0000n, BAD = 0n;
  let qCommits = 0, qCollapses = 0, qDecoheres = 0, qRearms = 0;
  const restore = new Set<number>();

  const agents: AIAgent[] = [];
  const TOURN = !!sc.tournaments && !flag("no-tournaments");
  const GUIDED = !!sc.guided && !flag("unguided");
  const joined = new Map<string, number>();
  const start = new Map<string, bigint>();
  const role = new Map<string, string>();
  for (let i = 0; i < sc.agents; i++) {
    const id = `ai-${i}`; m.addPlayer(id, 10_000n * U, true);
    const skill = sc.skills ? sc.skills[i % sc.skills.length] : "skilled";
    const tournamentTier = TOURN && skill !== "novice" ? 0 : undefined;
    agents.push(new AIAgent(id, PERS[i % PERS.length], seed * 7919 + i, undefined, { skill, tournamentTier })); start.set(id, 10_000n * U); role.set(id, skill);
    joined.set(id, m.curEpoch);
  }
  if (sc.sponsor) { m.addPlayer("sponsor", sc.sponsor * U); m.fundSponsorPool("sponsor", sc.sponsor * U); }
  const sponsor0 = m.sponsorPool;
  let newcomerSeq = 0;
  for (let i = 0; i < sc.whales; i++) {
    const id = `whale-${i}`; m.addPlayer(id, 150_000n * U, true);
    agents.push(new AIAgent(id, "speculator", seed * 104_729 + i, undefined, { tournamentTier: TOURN ? 1 : undefined })); start.set(id, 150_000n * U); role.set(id, "whale");
    joined.set(id, m.curEpoch);
  }
  const permitCaps: { owner: string; agent: string; cap: bigint }[] = [];
  for (let i = 0; i < sc.permitAgents; i++) {
    const owner = `human-${i}`; const agent = `delegate-${i}`; const cap = 400n * U;
    m.addPlayer(owner, 5_000n * U);
    m.createPermit(owner, agent, 3_000n * U, cap, 900n * U, Number(PARAMS.epochSlots) * (EPOCHS + 1));
    agents.push(new AIAgent(agent, PERS[i % PERS.length], seed * 31 + i, owner));
    permitCaps.push({ owner, agent, cap });
  }

  // Farmer: owns a world, ticks it relentlessly, claims every emission it can.
  const FARM0 = 40_000n * U;
  let farmId = "";
  if (sc.farmer) {
    m.addPlayer("farmer", FARM0);
    farmId = m.createRootWorld("farmer", "Farm", 0, MAX_ARCHITECT_FEE_BPS, 25_000n * U).id;
    // worst case: the farmer also owns cells of its own world and keeps them alive
    for (let i = 0; i < 8; i++) {
      try {
        m.acquire("farmer", farmId, i * 9, 10n ** 12n, PARAMS.minPrice, 200n * U);
        if (!m.canPlant("farmer", farmId, i * 9)) m.plant("farmer", farmId, i * 9, 0x0000183c3c180000n);
      } catch { /* */ }
    }
  }

  // I4: wash trade must be rejected.
  {
    const w = [...m.worlds.values()][0];
    try {
      m.addPlayer("washer", 2_000n * U);
      m.acquire("washer", w.id, 63, 10n ** 12n, PARAMS.minPrice, 100n * U);
      let rejected = false;
      try { m.acquire("washer", w.id, 63, 10n ** 12n, PARAMS.minPrice * 2n, 100n * U); } catch { rejected = true; }
      assert(rejected, "I4 self-acquire (wash trade) was accepted");
    } catch (e) { failures.push(`I4 setup: ${(e as Error).message}`); }
  }

  const farmW = () => m.world(farmId);
  const keeper0 = m.players.get("keeper")!.wallet;
  const founder0 = wealth(m, "founder");
  const prizeChecks: string[] = [];
  const pool0 = m.rewardPool, sunk0 = m.totalSunk;
  const dbg = new Map<string, bigint>();
  if (process.env.DEBUG_NEW) {
    for (const name of ["acquire", "plant", "topUp", "collect", "joinTournament", "withdraw", "tick", "createChildWorld", "quantumCommit", "quantumReveal", "swapOffer", "swapAccept", "registerModule", "claimTournamentPrize"] as const) {
      const orig = (m as any)[name]?.bind(m); if (!orig) continue;
      (m as any)[name] = (...args: any[]) => {
        const id = typeof args[0] === "string" && role.get(args[0]) === "newcomer" ? args[0] : null;
        const b = id ? wealth(m, id) : 0n;
        const r = orig(...args);
        if (id) dbg.set(name, (dbg.get(name) ?? 0n) + wealth(m, id) - b);
        return r;
      };
    }
  }
  const totalSteps = Math.ceil((EPOCHS * Number(PARAMS.epochSlots)) / STEP);
  for (let s = 0; s < totalSteps; s++) {
    m.advanceSlots(STEP);
    for (const id of m.worlds.keys()) if (!m.canTick(id)) { try { m.tick("keeper", id); } catch { /* raced */ } }
    if (farmId) {
      try { m.fundWorld("farmer", farmId, 300n * U); } catch { /* broke */ }
      if (!m.canTick(farmId)) { try { m.tick("farmer", farmId); } catch { /* */ } }
      // the farmer also harvests its own cells (season points) — the worst case for I3/I13
      farmW().territories.forEach((t, i) => { if (t.holder === "farmer" && farmW().pending[i] > 0n) { try { m.collect("farmer", farmId, i); } catch { /* */ } } });
    }
    for (const a of agents) if (a.rng.next() < 0.6) { try { a.act(m); } catch (e) { failures.push(`agent threw: ${(e as Error).message}`); } }
    // twins act in lock-step on mirrored cells: they commit at the same moments
    // (only when BOTH can), so the only difference is how they settle.
    //   honest     — always reveals; after a BAD collapse restores GOOD with one
    //                classical plant (the rational alternative to withholding)
    //   withholder — reveals only GOOD outcomes, abandons BAD ones (stake lost)
    if (twins.length) for (const j of [0, 1]) {
      const cells = twins.map((id, k) => ({ id, idx: 40 + k * 8 + j }));
      const open = cells.map((c) => m.superposition(worldA, c.idx));
      if (open.every((sp) => !sp) && cells.every((c) => m.canQuantumCommit(c.id, worldA, c.idx) === null)) {
        for (const c of cells) {
          const salt = new Uint8Array(32); salt[0] = s & 0xff; salt[1] = (s >> 8) & 0xff; salt[2] = c.idx; salt[3] = j;
          m.quantumCommit(c.id, worldA, c.idx, m.commitFor(c.id, worldA, c.idx, GOOD, BAD, 5_000, salt)); secrets.set(`${worldA}:${c.idx}`, salt); qCommits++;
        }
      }
      cells.forEach((c, k) => {
        const sp = m.superposition(worldA, c.idx);
        if (sp?.observed && sp.owner === c.id) {
          const good = m.previewCollapse(worldA, c.idx, 5_000)!.branchA;
          if (c.id === "honest" || good) {
            m.quantumCollapse(c.id, worldA, c.idx, GOOD, BAD, 5_000, secrets.get(`${worldA}:${c.idx}`)!); qCollapses++;
            if (!good) restore.add(c.idx);
          }
        }
        if (restore.has(c.idx) && m.canPlant(c.id, worldA, c.idx) === null) { try { m.plant(c.id, worldA, c.idx, GOOD); restore.delete(c.idx); } catch { /* */ } }
        const d = m.world(worldA).territories[c.idx];
        const tax = epochTax(TWIN_PRICE, PARAMS.harbergerBps);
        if (d.holder === c.id && d.deposit < tax * 2n) { try { m.topUp(c.id, worldA, c.idx, tax * 3n); } catch { /* */ } }
        void k;
      });
    }
    // keeper: settle SWAPs (bounty) and clean expired offers
    for (const s of [...m.swaps.values()]) {
      if (m.canSwapResolve(s.world, s.indexA, s.indexB) === null) m.swapResolve("keeper", s.world, s.indexA, s.indexB);
      else if (m.canSwapCancel("keeper", s.world, s.indexA, s.indexB) === null) m.swapCancel("keeper", s.world, s.indexA, s.indexB);
    }
    if (neutralId) {
      const nw = m.world(neutralId);
      assert(nw.architect === null && nw.architectAccrued === 0n && nw.architectFeeBps === 0, "I10 neutral world acquired a ruler / ruler income");
    }
    // keeper: measure & clean up (bounty = stake/20)
    for (const sp of [...m.superpositions.values()]) {
      if (m.canObserve(sp.world, sp.index) === null) { if (m.quantumObserve("keeper", sp.world, sp.index) === "rearmed") qRearms++; }
      else if (m.canDecohere(sp.world, sp.index) === null) { m.quantumDecohere("keeper", sp.world, sp.index); qDecoheres++; }
    }
    for (const w of m.worlds.values()) {
      w.territories.forEach((t, i) => { if (t.holder && m.wouldForeclose(w, i)) { try { m.settle(w.id, i); } catch { /* */ } } });
      if (w.parent && w.resonance >= 64) { try { m.breach(w.id); } catch { /* */ } }
    }
    if (m.canAdvanceEpoch()) {
      // keeper (permissionless): put everyone with season points on the leaderboard before the epoch closes
      for (const id of m.players.keys()) if (m.seasonPointsOf(id) > 0n) { try { m.seasonSubmit(id); } catch { /* */ } }
      const season = m.seasonId;
      m.advanceEpoch();
      if (m.seasonId !== season && m.lastSeason) {
        const ls = m.lastSeason;
        ls.top.forEach((e, r) => { if (e.player && ls.prizes[r] > bpsFloor(e.points, SEASON_PRIZE_CAP_BPS)) prizeChecks.push(`rank ${r + 1}`); });
        for (let r = 0; r < SEASON_TOP; r++) { try { m.claimSeasonPrize(r); } catch { /* empty rank */ } }
      }
      // keeper (permissionless): settle finished tournaments and credit the winners
      for (const t of m.tournaments.values()) {
        if (t.settled || m.seasonId <= t.seasonId) continue;
        m.settleTournament(t.seasonId, t.tier);
        for (let r = 0; r < TOURNAMENT_TOP; r++) { try { m.claimTournamentPrize(t.seasonId, t.tier, r); } catch { /* unpaid rank */ } }
      }
      for (const w of m.worlds.values()) { try { m.claimWorldEpoch(w.id); } catch { /* */ } }
      if (farmId) { try { m.claimArchitect("farmer", farmId); } catch { /* */ } }
      // newcomers: fresh novices arrive every epoch
      for (let k = 0; k < (sc.newcomers ?? 0); k++) {
        const id = `new-${newcomerSeq++}`; m.addPlayer(id, NEWCOMER0 * U, true);
        agents.push(new AIAgent(id, PERS[newcomerSeq % PERS.length], seed * 6_151 + newcomerSeq, undefined,
          { skill: "novice", guided: GUIDED, tournamentTier: TOURN && newcomerSeq % 2 === 0 ? 0 : undefined }));
        start.set(id, NEWCOMER0 * U); role.set(id, "newcomer"); joined.set(id, m.curEpoch);
      }
    }
    // I6
    assert(m.rewardPool >= 0n && m.rewardPool === pool0 + (m.totalSunk - sunk0) - m.totalEmitted, "I6 reward-pool ledger mismatch");
    // I12 / I13
    assert(m.sponsorPool >= 0n && m.sponsorPool === sponsor0 - m.totalSponsored, "I12 sponsor-pool ledger mismatch");
    assert(m.totalSponsored <= m.totalSunk, "I12 sponsor paid more than worlds sank");
    assert(m.seasonPool >= 0n && m.seasonPool === m.totalSeasonFunded - m.totalSeasonPaid, "I13 season-pool ledger mismatch");
    // I7
    for (const pc of permitCaps) {
      const p = m.permits.get(`${pc.owner}:${pc.agent}`);
      if (p && p.spent > pc.cap) failures.push(`I7 permit ${pc.agent} overspent ${fmt(p.spent)} > ${fmt(pc.cap)}`);
    }
  }
  m.check(); // I1 (also enforced after every mutation)
  if (process.env.DEBUG_NEW) {
    const tot = new Map<string, bigint>();
    for (const [k, v] of dbg) tot.set(k, v);
    const nn = [...start.keys()].filter((id) => role.get(id) === "newcomer" && m.curEpoch - (joined.get(id) ?? 0) >= 2);
    const total = nn.reduce((a, id) => a + wealth(m, id) - start.get(id)!, 0n);
    const active = [...tot.values()].reduce((a, v) => a + v, 0n);
    console.log(`newcomers(≥2 epochs) n=${nn.length} total PnL ${fmt(total)}; by action:`, [...tot.entries()].map(([k, v]) => `${k} ${fmt(v)}`).join(", "), `; passive (tax, buyouts…) ${fmt(total - active)}`);
  }

  // I2
  assert(m.totalEmitted <= pool0 + (m.totalSunk - sunk0), `I2 emission ${fmt(m.totalEmitted)} exceeds seed + pool inflows`);
  // I14 tournaments are exact: pool == Σ open pots, every pot fully paid or returned once settled
  const openPots = [...m.tournaments.values()].reduce((a, t) => a + t.pot, 0n);
  assert(m.tournamentPool === openPots, "I14 tournament pool ≠ Σ pots");
  for (const t of m.tournaments.values()) if (t.settled) assert(t.pot === 0n, `I14 settled tournament ${t.seasonId}:${t.tier} kept ${fmt(t.pot)}`);
  // I3
  let farmerPnl: bigint | undefined;
  if (sc.farmer) {
    const p = m.players.get("farmer")!;
    const farm = m.world(farmId);
    // Everything the farmer can ever get back: wallet + claimables + architect fees + pending on its cells.
    // World energy is NOT withdrawable (it can only be spent by ticks), so it's excluded.
    let back = p.wallet + p.claimable + farm.architectAccrued;
    farm.territories.forEach((t, i) => { if (t.holder === "farmer") back += t.deposit + farm.pending[i]; });
    farmerPnl = back - FARM0;
    assert(farmerPnl < 0n, `I3 self-farming was profitable: +${fmt(farmerPnl)}`);
  }
  // I5
  const studio = m.treasury + m.players.get("studio")!.wallet + m.players.get("studio")!.claimable
    + m.modules.reduce((a, x) => a + x.accrued, 0n) - studio0;
  assert(studio > 0n, "I5 studio earned nothing");

  // I8 / I9
  let withholdGap: bigint | undefined;
  if (sc.quantum) {
    // Open stakes count only while the outcome is still unknown; an observed
    // superposition the withholder refuses to reveal is lost by its own policy.
    const esc = (id: string) => [...m.superpositions.values()].filter((sp) => sp.owner === id && !sp.observed).reduce((a, sp) => a + sp.stake, 0n);
    const hw = wealth(m, "honest") + esc("honest"), ww = wealth(m, "withholder") + esc("withholder");
    withholdGap = ww - hw;
    assert(ww < hw, `I8 withholding paid off: withholder ${fmt(ww)} ≥ honest ${fmt(hw)}`);
    for (const w of m.worlds.values()) {
      const open = [...m.superpositions.values()].filter((sp) => sp.world === w.id).reduce((a, sp) => a + sp.stake, 0n)
        + [...m.swaps.values()].filter((s) => s.world === w.id).reduce((a, s) => a + s.premium + s.bounty, 0n);
      assert(open === w.quantumEscrow, `I9 escrow leak in ${w.id}`);
    }
  }
  const allCommits = m.events.filter((e) => e.kind === "quantum" && /суперпозицию/.test(e.text)).length;
  const allCollapses = m.events.filter((e) => e.kind === "quantum" && /Коллапс/.test(e.text)).length;
  // I11
  for (const x of m.modules) if (x.worldsUsing === 0) assert(x.accrued + x.totalEarned === 0n, `I11 unused module ${x.name} earned royalty`);
  const swapEv = m.events.filter((e) => e.kind === "swap");
  const aiLaws = m.modules.filter((x) => x.author !== "studio");
  const qStats = sc.quantum
    ? `ψ commits ${allCommits} (twins ${qCommits}), collapses ${allCollapses} (twins ${qCollapses}), decohered ${qDecoheres}, re-armed ${qRearms}`
      + (sc.neutral ? `; SWAP offers ${swapEv.filter((e) => /предлагает/.test(e.text)).length}, accepted ${swapEv.filter((e) => /принял/.test(e.text)).length}, exchanged ${swapEv.filter((e) => /обменялись/.test(e.text)).length}; AI laws ${aiLaws.length} (used by ${aiLaws.reduce((a, x) => a + x.worldsUsing, 0)} worlds, royalty ${fmt(aiLaws.reduce((a, x) => a + x.accrued + x.totalEarned, 0n))})` : "")
    : undefined;

  for (const r of prizeChecks) failures.push(`I13 season prize above 25% of points (${r})`);
  const pnls = [...start.entries()].map(([id, s0]) => wealth(m, id) - s0).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const byRole = new Map<string, bigint[]>();
  for (const [id, s0] of start) { const r = role.get(id) ?? "delegate"; if (!byRole.has(r)) byRole.set(r, []); byRole.get(r)!.push(wealth(m, id) - s0); }
  const players = [...start.entries()].filter(([id]) => role.get(id) !== "newcomer" || true);
  const winners = players.filter(([id, s0]) => wealth(m, id) > s0).length;
  const seasoned = players.filter(([id]) => m.curEpoch - (joined.get(id) ?? 0) >= 2);
  const seasonedWin = seasoned.filter(([id, s0]) => wealth(m, id) > s0).length;
  const roles = `в плюсе ${Math.round((100 * winners) / Math.max(1, players.length))}% из ${players.length}`
    + ` (сыгравших ≥2 эпох: ${Math.round((100 * seasonedWin) / Math.max(1, seasoned.length))}% из ${seasoned.length}) | ` + [...byRole.entries()].map(([r, a]) => roleLine(r, a)).filter(Boolean).join(" | ")
    + ` | keeper +${fmt(m.players.get("keeper")!.wallet - keeper0)} | founder ${fmt(wealth(m, "founder") - founder0)}`;
  const ls = m.lastSeason;
  const season = `сезоны: закрыто ${m.seasonId - 1}, фонд ${fmt(m.totalSeasonFunded)}, выплачено ${fmt(m.totalSeasonPaid)}`
    + (ls && ls.top[0].player ? ` (1-е место ${ls.top[0].player}: очки ${fmt(ls.top[0].points)} → приз ${fmt(ls.prizes[0])})` : "")
    + ` · спонсор: выплачено ${fmt(m.totalSponsored)} из ${fmt(sponsor0)}`
    + ` · эффективность: ${fmt(m.totalEfficiency)}`
    + (m.tournaments.size ? ` · турниры: ${m.tournaments.size}, взносы ${fmt(m.totalTournamentFees)}, призы ${fmt(m.totalTournamentPaid)}` : "");
  return {
    scenario: sc.name, seed, sunk: m.totalSunk, emitted: m.totalEmitted, studio, worlds: m.worlds.size,
    farmerPnl, withholdGap, qStats, agentMedianPnl: pnls.length ? pnls[Math.floor(pnls.length / 2)] : 0n, agentBestPnl: pnls.length ? pnls[pnls.length - 1] : 0n,
    permitOverspend: failures.filter((f) => f.startsWith("I7")).length, failures, roles, season,
  };
}

const t0 = Date.now();
let bad = 0;
console.log(`RECURSIA econ sim — ${SCENARIOS.length} scenarios × ${SEEDS} seeds × ${EPOCHS} epochs${QUICK ? " (quick)" : ""}\n`);
console.log(["scenario".padEnd(18), "seed", "worlds", "to pool".padStart(12), "emitted".padStart(12), "emit/pool", "studio".padStart(11), "farmer PnL".padStart(12), "median AI PnL".padStart(14), "best AI PnL".padStart(12)].join("  "));
for (const sc0 of SCENARIOS) {
  if (ONLY && !sc0.name.includes(ONLY)) continue;
  const sc = SPONSOR_OVERRIDE === null ? sc0 : { ...sc0, sponsor: SPONSOR_OVERRIDE };
  for (let seed = 1; seed <= SEEDS; seed++) {
    let r: Result;
    try { r = run(sc, seed); } catch (e) {
      bad++; console.log(`${sc.name.padEnd(18)}  ${seed}  CRASH: ${(e as Error).message}`); continue;
    }
    const ratio = r.sunk === 0n ? 0 : Number((r.emitted * 10_000n) / r.sunk) / 100;
    console.log([
      r.scenario.padEnd(18), String(seed).padStart(4), String(r.worlds).padStart(6), fmt(r.sunk).padStart(12), fmt(r.emitted).padStart(12),
      `${ratio.toFixed(1)}%`.padStart(9), fmt(r.studio).padStart(11), (r.farmerPnl === undefined ? "—" : fmt(r.farmerPnl)).padStart(12), fmt(r.agentMedianPnl).padStart(14), fmt(r.agentBestPnl).padStart(12),
    ].join("  "));
    console.log(`   👥 ${r.roles}`);
    console.log(`   🏆 ${r.season}`);
    if (r.qStats) console.log(`   ⚛ ${r.qStats}; withholder − honest = ${r.withholdGap === undefined ? "—" : fmt(r.withholdGap)} SKR`);
    const uniq = [...new Set(r.failures)];
    for (const f of uniq.slice(0, 5)) console.log(`   ✗ ${f}`);
    if (uniq.length) bad++;
  }
}
console.log(`\n${bad === 0 ? "✓ all invariants held" : `✗ ${bad} run(s) violated invariants`} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(bad === 0 ? 0 : 1);
