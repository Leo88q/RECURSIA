/**
 * RECURSIA economic stress simulation (checklist #56: econ sim before mainnet).
 *
 * Runs the *reference model* (bit-exact mirror of the on-chain rules, validated
 * by cross-implementation vectors) through several adversarial scenarios and
 * asserts the economic invariants the design relies on:
 *
 *   I1  supply conservation: circulating + burned == TOTAL_SUPPLY every step
 *       (GameModel.check() runs after every mutation and throws otherwise)
 *   I2  emission is burn-backed: totalEmitted <= totalBurned * rebateCap
 *   I3  self-farming is unprofitable: an actor ticking its own world to farm
 *       emission ends with strictly less than it started with
 *   I4  wash trading is impossible (self-acquire rejected by the program)
 *   I5  the studio earns (protocol fee + module royalties) while players play
 *   I6  reward pool is monotonically non-increasing and never negative
 *   I7  AI agents cannot overspend their permit (per-epoch cap enforced)
 *
 * Usage: npm run econ [-- --quick] [-- --seeds N] [-- --epochs N]
 */
import { AIAgent, type Personality } from "../src/agents.js";
import { DEFAULT_PARAMS, MAX_ARCHITECT_FEE_BPS, ONE, PHYSICS_PRESETS, type Params } from "../src/constants.js";
import { GameModel } from "../src/model.js";
import { bpsFloor } from "../src/economy.js";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const QUICK = flag("quick");
const SEEDS = opt("seeds", QUICK ? 2 : 6);
const EPOCHS = opt("epochs", QUICK ? 6 : 20);
const STEP = 300;
const PARAMS: Params = { ...DEFAULT_PARAMS, epochSlots: 9_000n };

type Scenario = { name: string; agents: number; farmer: boolean; whales: number; permitAgents: number };
const SCENARIOS: Scenario[] = [
  { name: "baseline", agents: 12, farmer: false, whales: 0, permitAgents: 0 },
  { name: "self-farm attack", agents: 8, farmer: true, whales: 0, permitAgents: 0 },
  { name: "whale pressure", agents: 8, farmer: false, whales: 3, permitAgents: 0 },
  { name: "delegated AI", agents: 6, farmer: false, whales: 0, permitAgents: 6 },
  { name: "thin market", agents: 2, farmer: false, whales: 0, permitAgents: 0 },
];
const PERS: Personality[] = ["gardener", "expansionist", "speculator", "demiurge"];
const fmt = (v: bigint) => (Number(v / (ONE / 100n)) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

interface Result {
  scenario: string; seed: number; burned: bigint; emitted: bigint; studio: bigint; worlds: number;
  farmerPnl?: bigint; agentMedianPnl: bigint; agentBestPnl: bigint; permitOverspend: number; failures: string[];
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

  m.addPlayer("studio", 100_000n * ONE);
  for (const p of PHYSICS_PRESETS) m.registerModule("studio", p.name, p.birth, p.survive, p.royaltyBps);
  m.addPlayer("keeper", 0n);
  m.addPlayer("founder", 60_000n * ONE);
  m.createRootWorld("founder", "A", 0, 1_500, 8_000n * ONE);
  m.createRootWorld("founder", "B", 1, 2_500, 6_000n * ONE);

  const agents: AIAgent[] = [];
  const start = new Map<string, bigint>();
  for (let i = 0; i < sc.agents; i++) {
    const id = `ai-${i}`; m.addPlayer(id, 10_000n * ONE, true);
    agents.push(new AIAgent(id, PERS[i % PERS.length], seed * 7919 + i)); start.set(id, 10_000n * ONE);
  }
  for (let i = 0; i < sc.whales; i++) {
    const id = `whale-${i}`; m.addPlayer(id, 150_000n * ONE, true);
    agents.push(new AIAgent(id, "speculator", seed * 104_729 + i)); start.set(id, 150_000n * ONE);
  }
  const permitCaps: { owner: string; agent: string; cap: bigint }[] = [];
  for (let i = 0; i < sc.permitAgents; i++) {
    const owner = `human-${i}`; const agent = `delegate-${i}`; const cap = 400n * ONE;
    m.addPlayer(owner, 5_000n * ONE);
    m.createPermit(owner, agent, 3_000n * ONE, cap, 900n * ONE, Number(PARAMS.epochSlots) * (EPOCHS + 1));
    agents.push(new AIAgent(agent, PERS[i % PERS.length], seed * 31 + i, owner));
    permitCaps.push({ owner, agent, cap });
  }

  // Farmer: owns a world, ticks it relentlessly, claims every emission it can.
  const FARM0 = 40_000n * ONE;
  let farmId = "";
  if (sc.farmer) {
    m.addPlayer("farmer", FARM0);
    farmId = m.createRootWorld("farmer", "Farm", 0, MAX_ARCHITECT_FEE_BPS, 25_000n * ONE).id;
    // worst case: the farmer also owns cells of its own world and keeps them alive
    for (let i = 0; i < 8; i++) {
      try {
        m.acquire("farmer", farmId, i * 9, 10n ** 12n, PARAMS.minPrice, 200n * ONE);
        if (!m.canPlant("farmer", farmId, i * 9)) m.plant("farmer", farmId, i * 9, 0x0000183c3c180000n);
      } catch { /* */ }
    }
  }

  // I4: wash trade must be rejected.
  {
    const w = [...m.worlds.values()][0];
    try {
      m.addPlayer("washer", 2_000n * ONE);
      m.acquire("washer", w.id, 63, 10n ** 12n, PARAMS.minPrice, 100n * ONE);
      let rejected = false;
      try { m.acquire("washer", w.id, 63, 10n ** 12n, PARAMS.minPrice * 2n, 100n * ONE); } catch { rejected = true; }
      assert(rejected, "I4 self-acquire (wash trade) was accepted");
    } catch (e) { failures.push(`I4 setup: ${(e as Error).message}`); }
  }

  const studio0 = m.treasury + (m.players.get("studio")!.wallet);
  let lastPool = m.rewardPool;
  const totalSteps = Math.ceil((EPOCHS * Number(PARAMS.epochSlots)) / STEP);
  for (let s = 0; s < totalSteps; s++) {
    m.advanceSlots(STEP);
    for (const id of m.worlds.keys()) if (!m.canTick(id)) { try { m.tick("keeper", id); } catch { /* raced */ } }
    if (farmId) {
      try { m.fundWorld("farmer", farmId, 300n * ONE); } catch { /* broke */ }
      if (!m.canTick(farmId)) { try { m.tick("farmer", farmId); } catch { /* */ } }
    }
    for (const a of agents) if (a.rng.next() < 0.6) { try { a.act(m); } catch (e) { failures.push(`agent threw: ${(e as Error).message}`); } }
    for (const w of m.worlds.values()) {
      w.territories.forEach((t, i) => { if (t.holder && m.wouldForeclose(w, i)) { try { m.settle(w.id, i); } catch { /* */ } } });
      if (w.parent && w.resonance >= 64) { try { m.breach(w.id); } catch { /* */ } }
    }
    if (m.canAdvanceEpoch()) {
      m.advanceEpoch();
      for (const w of m.worlds.values()) { try { m.claimWorldEpoch(w.id); } catch { /* */ } }
      if (farmId) { try { m.claimArchitect("farmer", farmId); } catch { /* */ } }
    }
    // I6
    assert(m.rewardPool <= lastPool && m.rewardPool >= 0n, "I6 reward pool increased or went negative");
    lastPool = m.rewardPool;
    // I7
    for (const pc of permitCaps) {
      const p = m.permits.get(`${pc.owner}:${pc.agent}`);
      if (p && p.spent > pc.cap) failures.push(`I7 permit ${pc.agent} overspent ${fmt(p.spent)} > ${fmt(pc.cap)}`);
    }
  }
  m.check(); // I1 (also enforced after every mutation)

  // I2
  assert(m.totalEmitted <= bpsFloor(m.totalBurned, PARAMS.rebateCapBps), `I2 emission ${fmt(m.totalEmitted)} exceeds burn-backed cap`);
  // I3
  let farmerPnl: bigint | undefined;
  if (sc.farmer) {
    const p = m.players.get("farmer")!;
    const farm = m.world(farmId);
    // Everything the farmer can ever get back: wallet + claimables + architect fees + pending on its cells.
    // World energy is NOT withdrawable (it can only be burned by ticks), so it's excluded.
    let back = p.wallet + p.claimable + farm.architectAccrued;
    farm.territories.forEach((t, i) => { if (t.holder === "farmer") back += t.deposit + farm.pending[i]; });
    farmerPnl = back - FARM0;
    assert(farmerPnl < 0n, `I3 self-farming was profitable: +${fmt(farmerPnl)}`);
  }
  // I5
  const studio = m.treasury + m.players.get("studio")!.wallet + m.players.get("studio")!.claimable
    + m.modules.reduce((a, x) => a + x.accrued, 0n) - studio0;
  assert(studio > 0n, "I5 studio earned nothing");

  const pnls = [...start.entries()].map(([id, s0]) => wealth(m, id) - s0).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    scenario: sc.name, seed, burned: m.totalBurned, emitted: m.totalEmitted, studio, worlds: m.worlds.size,
    farmerPnl, agentMedianPnl: pnls.length ? pnls[Math.floor(pnls.length / 2)] : 0n, agentBestPnl: pnls.length ? pnls[pnls.length - 1] : 0n,
    permitOverspend: failures.filter((f) => f.startsWith("I7")).length, failures,
  };
}

const t0 = Date.now();
let bad = 0;
console.log(`RECURSIA econ sim — ${SCENARIOS.length} scenarios × ${SEEDS} seeds × ${EPOCHS} epochs${QUICK ? " (quick)" : ""}\n`);
console.log(["scenario".padEnd(18), "seed", "worlds", "burned".padStart(12), "emitted".padStart(12), "emit/burn", "studio".padStart(11), "farmer PnL".padStart(12), "median AI PnL".padStart(14), "best AI PnL".padStart(12)].join("  "));
for (const sc of SCENARIOS) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    let r: Result;
    try { r = run(sc, seed); } catch (e) {
      bad++; console.log(`${sc.name.padEnd(18)}  ${seed}  CRASH: ${(e as Error).message}`); continue;
    }
    const ratio = r.burned === 0n ? 0 : Number((r.emitted * 10_000n) / r.burned) / 100;
    console.log([
      r.scenario.padEnd(18), String(seed).padStart(4), String(r.worlds).padStart(6), fmt(r.burned).padStart(12), fmt(r.emitted).padStart(12),
      `${ratio.toFixed(1)}%`.padStart(9), fmt(r.studio).padStart(11), (r.farmerPnl === undefined ? "—" : fmt(r.farmerPnl)).padStart(12), fmt(r.agentMedianPnl).padStart(14), fmt(r.agentBestPnl).padStart(12),
    ].join("  "));
    const uniq = [...new Set(r.failures)];
    for (const f of uniq.slice(0, 5)) console.log(`   ✗ ${f}`);
    if (uniq.length) bad++;
  }
}
console.log(`\n${bad === 0 ? "✓ all invariants held" : `✗ ${bad} run(s) violated invariants`} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(bad === 0 ? 0 : 1);
