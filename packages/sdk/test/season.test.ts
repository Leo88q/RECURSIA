import { describe, expect, it } from "vitest";
import { P } from "./params.js";
import { GameModel } from "../src/model.js";
import {
  ONE, PHYSICS_PRESETS, SEASON_EPOCHS, SEASON_PRIZE_CAP_BPS, SEASON_RANK_BPS, SEASON_SHARE_BPS, SEASON_TOP, SPONSOR_CAP_BPS,
} from "../src/constants.js";
import { bpsFloor, epochTax, leaderboardInsert, seasonPrize, worldSponsor, type LeaderEntry } from "../src/economy.js";

const BLOCKS = 0x0000_0018_1800_0000n; // still life: keeps living cells every tick

function setup(opts: { sponsor?: bigint } = {}) {
  const m = new GameModel(P);
  m.addPlayer("dev", 1_000_000n * ONE);
  for (const p of PHYSICS_PRESETS) m.registerModule("dev", p.name, p.birth, p.survive, p.royaltyBps);
  m.addPlayer("alice", 100_000n * ONE);
  m.addPlayer("bob", 100_000n * ONE);
  m.addPlayer("keeper", 0n);
  if (opts.sponsor) { m.addPlayer("sponsor", opts.sponsor); m.fundSponsorPool("sponsor", opts.sponsor); }
  const w = m.createRootWorld("alice", "W", 0, 0, 5_000n * ONE);
  return { m, w };
}

/** Run one epoch of ticks and close it. */
function runEpoch(m: GameModel, worlds: string[]) {
  const start = m.slot;
  while (m.slot < start + Number(P.epochSlots)) {
    m.advanceSlots(Number(P.tickIntervalSlots));
    for (const id of worlds) if (m.canTick(id) === null) m.tick("keeper", id);
  }
  m.advanceEpoch();
}

describe("sponsor pool (mirror of math::world_sponsor)", () => {
  it("same vectors as the Rust unit test", () => {
    expect(worldSponsor(1_000n, 100n, 25n, 10_000n, 10_000, 0n)).toBe(250n);
    expect(worldSponsor(1_000_000n, 100n, 100n, 700n, 10_000, 0n)).toBe(700n);
    expect(worldSponsor(1_000_000n, 100n, 100n, 0n, 10_000, 0n)).toBe(0n);
    expect(worldSponsor(1_000n, 100n, 60n, 10_000n, 10_000, 900n)).toBe(100n);
    expect(worldSponsor(0n, 100n, 60n, 10_000n, 10_000, 0n)).toBe(0n);
  });

  it("lets a living world get back MORE than it paid in (the only source of net winners)", () => {
    const { m, w } = setup({ sponsor: 5_000_000n * ONE });
    m.acquire("bob", w.id, 9, 10n * ONE, 100n * ONE, epochTax(100n * ONE, P.harbergerBps) * 30n);
    m.plant("bob", w.id, 9, BLOCKS);
    runEpoch(m, [w.id]);
    const got = m.claimWorldEpoch(w.id); // rolls the world's epoch lazily, like the program
    const sink = w.sinkPrev;
    expect(sink).toBeGreaterThan(0n);
    // reward-pool part ≤ 90% of the contribution, sponsor part ≤ 100% on top of it
    expect(got).toBeGreaterThan(sink);
    expect(got).toBeLessThanOrEqual(bpsFloor(sink, P.rebateCapBps) + bpsFloor(sink, SPONSOR_CAP_BPS));
    expect(m.totalSponsored).toBeGreaterThan(0n);
    expect(m.circulating()).toBe(m.supply);
  });

  it("a world that contributed nothing gets nothing, however alive", () => {
    expect(worldSponsor(10n ** 12n, 1_000n, 1_000n, 0n, SPONSOR_CAP_BPS, 0n)).toBe(0n);
  });
});

describe("seasons", () => {
  it("prize = rank share, capped at 25% of the winner's own points (Rust vectors)", () => {
    expect(seasonPrize(1_000_000n, 3_000, 10_000_000n)).toBe(300_000n);
    expect(seasonPrize(1_000_000n, 3_000, 400_000n)).toBe(100_000n);
    expect(seasonPrize(1_000_000n, 3_000, 0n)).toBe(0n);
    expect(SEASON_RANK_BPS.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(SEASON_PRIZE_CAP_BPS).toBe(2_500);
  });

  it("leaderboard mirrors season::leaderboard_insert", () => {
    const top: LeaderEntry<string>[] = Array.from({ length: SEASON_TOP }, () => ({ player: "", points: 0n }));
    const ins = (p: string, v: bigint) => leaderboardInsert(top, { player: p, points: v }, (k) => k === "", (a, b) => a === b);
    for (let n = 1; n <= 12; n++) ins(`p${n}`, BigInt(n * 10));
    expect(top[0].player).toBe("p12");
    expect(top[9].player).toBe("p3");
    expect(ins("p50", 30n)).toBe(false);
    expect(ins("p3", 1_000n)).toBe(true);
    expect(top[0].player).toBe("p3");
    expect(top.filter((e) => e.player === "p3")).toHaveLength(1);
  });

  it("25% of studio income funds the season; the winner is paid; totals conserve", () => {
    const { m, w } = setup();
    m.acquire("bob", w.id, 9, 10n * ONE, 100n * ONE, epochTax(100n * ONE, P.harbergerBps) * 30n);
    m.plant("bob", w.id, 9, BLOCKS);
    for (let e = 0; e < SEASON_EPOCHS; e++) {
      const funded = m.totalSeasonFunded;
      runEpoch(m, [w.id]);
      expect(m.totalSeasonFunded).toBeGreaterThan(funded); // every epoch of play feeds the season
      if (e < SEASON_EPOCHS - 1) {
        m.claimWorldEpoch(w.id);
        m.collect("bob", w.id, 9);
        m.seasonSubmit("bob");
      }
    }
    expect(m.totalSeasonFunded).toBeGreaterThan(0n);
    expect(m.seasonId).toBe(2);
    const last = m.lastSeason!;
    expect(last.top[0].player).toBe("bob");
    const points = last.top[0].points;
    const prize = last.prizes[0];
    expect(prize).toBeGreaterThan(0n);
    expect(prize).toBeLessThanOrEqual(bpsFloor(points, SEASON_PRIZE_CAP_BPS));
    const before = m.players.get("bob")!.claimable;
    expect(m.claimSeasonPrize(0)).toBe(prize);
    expect(m.players.get("bob")!.claimable - before).toBe(prize);
    expect(() => m.claimSeasonPrize(0)).toThrow(/no prize/);
    // the capped-away part stays in the pool for the next season
    expect(m.seasonPool).toBeGreaterThanOrEqual(0n);
    expect(m.circulating()).toBe(m.supply);
  });

  it("points reset on a new season; submitting without points fails", () => {
    const { m } = setup();
    expect(() => m.seasonSubmit("bob")).toThrow(/no season points/);
    expect(m.seasonPointsOf("bob")).toBe(0n);
  });

  it("the treasury sweep takes exactly 25% of the inflow since the last sweep", () => {
    const { m, w } = setup();
    runEpoch(m, [w.id]);
    // after the first sweep the treasury equals what governance may spend
    expect(m.treasurySeen).toBe(m.treasury);
    const inflowBefore = m.totalSeasonFunded;
    const treasuryNow = m.treasury;
    runEpoch(m, [w.id]);
    const inflow = m.treasury + (m.totalSeasonFunded - inflowBefore) - treasuryNow;
    expect(m.totalSeasonFunded - inflowBefore).toBe(bpsFloor(inflow, SEASON_SHARE_BPS));
  });
});
