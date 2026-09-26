// Generates cross-implementation vectors consumed by the Rust unit tests
// (programs/recursia/src/sim.rs::shared_vectors).
import { writeFileSync } from "node:fs";
import { PHYSICS_PRESETS } from "../src/constants.js";
import { Rng } from "../src/agents.js";
import { bigbang, stepN, territoryCounts, type Grid } from "../src/sim.js";

const hex = (g: Grid) => Array.from(g, (v) => v.toString(16));
const rng = new Rng(20260927);
const cases: unknown[] = [];
PHYSICS_PRESETS.forEach((p, k) => {
  for (const gens of [1, 4, 8]) {
    const input = new BigUint64Array(64);
    for (let i = 0; i < 64; i++) input[i] = rng.big64() & rng.big64();
    const out = stepN(input, p.birth, p.survive, gens);
    cases.push({ name: `${p.name}-${gens}`, birth: p.birth, survive: p.survive, gens, input: hex(input), output: hex(out), counts: territoryCounts(out) });
  }
  const bb = bigbang(new Uint8Array(32).fill(k + 1));
  const out = stepN(bb, p.birth, p.survive, 4);
  cases.push({ name: `${p.name}-bigbang`, birth: p.birth, survive: p.survive, gens: 4, input: hex(bb), output: hex(out), counts: territoryCounts(out) });
});
writeFileSync(new URL("../../../tests/vectors/sim.json", import.meta.url), JSON.stringify({ cases }, null, 1));
console.log(`wrote ${cases.length} vectors`);
