import { describe, expect, it } from "vitest";
import { territoryCounts, writeBlock } from "@recursia/sdk";
import { Sandbox, YOU, KEEPER, fmtRcr } from "../src/sandbox";
import { mentorTips, recommendFirstCell, safestPattern, tutorialSteps, type StepId } from "../src/lib/mentor";

const fmt = (v: bigint) => fmtRcr(v, 2);

describe("onboarding: first steps + mentor", () => {
  it("the recommended first plot + verified pattern really stays alive through 48 generations of real ticks", () => {
    const sb = new Sandbox(7);
    const m = sb.m;
    const rec = recommendFirstCell(m)!;
    expect(rec).not.toBeNull();
    const w = m.world(rec.world);
    expect(w.territories[rec.idx].holder).toBeNull();
    m.acquire(YOU, rec.world, rec.idx, rec.price, m.params.minPrice, sb.defaultDeposit(m.params.minPrice));
    const safe = safestPattern(w, rec.idx)!; // recomputed after the purchase: same grid
    m.plant(YOU, rec.world, rec.idx, safe.pattern);
    const gen0 = w.generation;
    // real ticks of the model (4 generations each), no other actors
    while (w.generation < gen0 + 48) { m.advanceSlots(Number(m.params.tickIntervalSlots)); m.tick(KEEPER, rec.world); }
    expect(w.alive[rec.idx]).toBeGreaterThan(0);
  });

  it("quest steps complete in order and stay completed (latched)", () => {
    const sb = new Sandbox(3);
    const m = sb.m;
    const ids = () => tutorialSteps(m, YOU).filter((s) => s.done).map((s) => s.id);
    expect(ids()).toEqual([]);
    const rec = recommendFirstCell(m)!;
    m.acquire(YOU, rec.world, rec.idx, rec.price, m.params.minPrice, sb.defaultDeposit(m.params.minPrice) * 10n);
    expect(ids()).toEqual(["acquire"]);
    m.plant(YOU, rec.world, rec.idx, safestPattern(m.world(rec.world), rec.idx)!.pattern);
    expect(ids()).toEqual(["acquire", "plant"]);
    // latched steps survive the cooldown ending
    const latched = new Set<StepId>(["acquire", "plant"]);
    for (let i = 0; i < 80 && !tutorialSteps(m, YOU, latched).find((s) => s.id === "earn")!.done; i++) sb.step();
    expect(tutorialSteps(m, YOU, latched).find((s) => s.id === "earn")!.done).toBe(true);
    latched.add("earn");
    m.collect(YOU, rec.world, rec.idx);
    expect(tutorialSteps(m, YOU, latched).every((s) => s.done)).toBe(true);
  });

  it("mentor: urgent things first — foreclosure, lost secret, empty land; opportunities last", () => {
    const sb = new Sandbox(5);
    const m = sb.m;
    const rec = recommendFirstCell(m)!;
    m.acquire(YOU, rec.world, rec.idx, rec.price, m.params.minPrice, sb.defaultDeposit(m.params.minPrice));
    const w = m.world(rec.world); writeBlock(w.grid, rec.idx, 0n); w.alive = territoryCounts(w.grid); // an empty plot
    let tips = mentorTips(m, YOU, fmt, new Set(), 10);
    expect(tips.some((t) => t.level === "warn" && /пустая/.test(t.text) && t.at?.idx === rec.idx)).toBe(true);
    // deposit below one epoch of tax → danger, ranked first
    m.world(rec.world).territories[rec.idx].deposit = 1n;
    tips = mentorTips(m, YOU, fmt, new Set(), 10);
    expect(tips[0].level).toBe("danger");
    expect(tips[0].text).toMatch(/изымут/);
    expect(tips.map((t) => t.level)).toEqual([...tips.map((t) => t.level)].sort((a, b) => ["danger", "warn", "tip", "ok"].indexOf(a) - ["danger", "warn", "tip", "ok"].indexOf(b)));
    expect(mentorTips(m, YOU, fmt).length).toBeLessThanOrEqual(3);
  });
});
