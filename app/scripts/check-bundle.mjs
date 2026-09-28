#!/usr/bin/env node
// Bundle budget (CI). The first paint (sandbox) must stay light; the live-mode
// chunk (wallet adapter + web3) is lazy and has its own budget.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const html = readFileSync(dist + "index.html", "utf8");
const assets = readdirSync(dist + "assets");
const gz = (f) => gzipSync(readFileSync(dist + "assets/" + f)).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// initial = every JS/CSS referenced from index.html (entry + modulepreload)
const initial = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const lazy = assets.filter((f) => /\.(js|css)$/.test(f) && !initial.includes(f));
const BUDGET = { initialGz: 150 * 1024, lazyChunkGz: 200 * 1024, totalRaw: 1.6 * 1024 * 1024 };

let fail = 0;
const initialGz = initial.reduce((a, f) => a + gz(f), 0);
console.log(`initial (${initial.length} files): ${kb(initialGz)} gz  [budget ${kb(BUDGET.initialGz)}]`);
if (initialGz > BUDGET.initialGz) { console.error("✗ initial bundle over budget"); fail++; }
for (const f of lazy) {
  const g = gz(f);
  console.log(`lazy ${f}: ${kb(g)} gz`);
  if (g > BUDGET.lazyChunkGz) { console.error(`✗ ${f} over lazy-chunk budget ${kb(BUDGET.lazyChunkGz)}`); fail++; }
}
// art: painted icons/backdrops are self-hosted, content-hashed (immutable cache) and budgeted separately
// landing illustrations (src/assets/landing) are loading="lazy" — below the fold, never part of the first
// paint — so they get their own budget. Matched by content (names like bg/quantum also exist among the icons).
const landDir = fileURLToPath(new URL("../src/assets/landing/", import.meta.url));
const landBlobs = readdirSync(landDir).map((f) => readFileSync(landDir + f));
const landingImgs = assets.filter((f) => /\.webp$/.test(f) && landBlobs.some((b) => b.equals(readFileSync(dist + "assets/" + f))));
const landingSet = new Set(landingImgs);
const imgs = assets.filter((f) => /\.(webp|png|jpe?g|avif|svg)$/.test(f) && !landingSet.has(f));
const imgTotal = imgs.reduce((a, f) => a + statSync(dist + "assets/" + f).size, 0);
console.log(`images (${imgs.length}): ${kb(imgTotal)} [budget 400.0 KB, ≤ 160 KB each]`);
if (imgTotal > 400 * 1024) { console.error("✗ images over budget"); fail++; }
for (const f of imgs) { const sz = statSync(dist + "assets/" + f).size; if (sz > 160 * 1024) { console.error(`✗ ${f} ${kb(sz)} > 160 KB — re-run scripts/build-art.sh`); fail++; } }
const landTotal = landingImgs.reduce((a, f) => a + statSync(dist + "assets/" + f).size, 0);
console.log(`landing illustrations (${landingImgs.length}, lazy): ${kb(landTotal)} [budget 700.0 KB, ≤ 110 KB each]`);
if (landingImgs.length !== landBlobs.length) { console.error(`✗ expected ${landBlobs.length} landing illustrations in dist, found ${landingImgs.length}`); fail++; }
if (landTotal > 700 * 1024) { console.error("✗ landing illustrations over budget"); fail++; }
for (const f of landingImgs) { const sz = statSync(dist + "assets/" + f).size; if (sz > 110 * 1024) { console.error(`✗ ${f} ${kb(sz)} > 110 KB — re-run scripts/build-art.sh`); fail++; } }
const total = assets.filter((f) => !landingSet.has(f)).reduce((a, f) => a + statSync(dist + "assets/" + f).size, 0);
console.log(`total assets (without landing art): ${kb(total)} raw [budget ${kb(BUDGET.totalRaw)}]`);
if (total > BUDGET.totalRaw) { console.error("✗ total over budget"); fail++; }
if (assets.some((f) => f.endsWith(".map"))) { console.error("✗ source maps must not ship"); fail++; }
if (!readdirSync(dist).includes("_headers")) { console.error("✗ dist/_headers missing"); fail++; }
if (!/Content-Security-Policy/.test(html)) { console.error("✗ CSP meta missing"); fail++; }
// public compliance files must ship with the bundle (checklist 7.2 / 7.3)
for (const p of [".well-known/security.txt", "robots.txt", "manifest.webmanifest", "_headers"]) {
  if (!existsSync(dist + p)) { console.error(`✗ dist/${p} missing`); fail++; }
}
process.exit(fail ? 1 : 0);
