// Generates cross-implementation vectors consumed by the Rust unit tests
// (programs/recursia/src/sim.rs::shared_vectors, quantum.rs::shared_quantum_vectors).
import { writeFileSync } from "node:fs";
import { PHYSICS_PRESETS } from "../src/constants.js";
import { Rng } from "../src/agents.js";
import { bigbang, stepN, stepNQ, territoryCounts, type Grid } from "../src/sim.js";
import { collapse, commitment, hashv, neighbour, quantumSeed } from "../src/quantum.js";

const hex = (g: Grid) => Array.from(g, (v) => v.toString(16));
const bhex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const rng = new Rng(20260927);
const bytes32 = () => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) b[i] = rng.int(256); return b; };
const cases: unknown[] = [];
PHYSICS_PRESETS.forEach((p, k) => {
  if (p.qAmp === 0) {
    for (const gens of [1, 4, 8]) {
      const input = new BigUint64Array(64);
      for (let i = 0; i < 64; i++) input[i] = rng.big64() & rng.big64();
      const out = stepN(input, p.birth, p.survive, gens);
      cases.push({ name: `${p.name}-${gens}`, birth: p.birth, survive: p.survive, gens, input: hex(input), output: hex(out), counts: territoryCounts(out) });
    }
    const bb = bigbang(new Uint8Array(32).fill(k + 1));
    const out = stepN(bb, p.birth, p.survive, 4);
    cases.push({ name: `${p.name}-bigbang`, birth: p.birth, survive: p.survive, gens: 4, input: hex(bb), output: hex(out), counts: territoryCounts(out) });
  }
});
// quantum presets (appended so the classical vectors stay byte-identical)
PHYSICS_PRESETS.forEach((p, k) => {
  if (p.qAmp === 0) return;
  for (const gens of [1, 4]) {
    const bb = bigbang(new Uint8Array(32).fill(k + 40 + gens));
    const seed = quantumSeed(bytes32(), bytes32(), BigInt(1000 * gens + k));
    const gen0 = BigInt(1000 * gens + k);
    const out = stepNQ(bb, p.birth, p.survive, { qBirth: p.qBirth, qSurvive: p.qSurvive, amp: p.qAmp, seed }, gen0, gens);
    cases.push({
      name: `${p.name}-q${gens}`, birth: p.birth, survive: p.survive, gens, input: hex(bb), output: hex(out), counts: territoryCounts(out),
      qBirth: p.qBirth, qSurvive: p.qSurvive, amp: p.qAmp, seed: seed.map((s) => s.toString(16)), gen0: Number(gen0),
    });
  }
});
writeFileSync(new URL("../../../tests/vectors/sim.json", import.meta.url), JSON.stringify({ cases }, null, 1));

// hashing / collapse vectors
const q: unknown[] = [];
for (let i = 0; i < 12; i++) {
  const slotHash = bytes32(), world = bytes32(), owner = bytes32(), salt = bytes32();
  const gen = BigInt(rng.int(1_000_000));
  const a = rng.big64(), b = rng.big64(); const w = rng.int(10_001); const idx = rng.int(64);
  const c = commitment(a, b, w, salt, owner, world, idx);
  const col = collapse(slotHash, c, w);
  q.push({
    slotHash: bhex(slotHash), world: bhex(world), owner: bhex(owner), salt: bhex(salt), gen: Number(gen),
    seed: quantumSeed(slotHash, world, gen).map((s) => s.toString(16)),
    a: a.toString(16), b: b.toString(16), weight: w, index: idx, commitment: bhex(c),
    branchA: col.branchA, tunnel: col.tunnel, tunnelDir: col.tunnelDir, neighbour: neighbour(idx, col.tunnelDir),
  });
}
writeFileSync(new URL("../../../tests/vectors/quantum.json", import.meta.url), JSON.stringify({ hashvEmpty: bhex(hashv()), cases: q }, null, 1));
console.log(`wrote ${cases.length} sim vectors, ${q.length} quantum vectors`);
