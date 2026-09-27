#!/usr/bin/env node
// Bundle budget (CI). The first paint (sandbox) must stay light; the live-mode
// chunk (wallet adapter + web3) is lazy and has its own budget.
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const total = assets.reduce((a, f) => a + statSync(dist + "assets/" + f).size, 0);
console.log(`total assets: ${kb(total)} raw [budget ${kb(BUDGET.totalRaw)}]`);
if (total > BUDGET.totalRaw) { console.error("✗ total over budget"); fail++; }
if (assets.some((f) => f.endsWith(".map"))) { console.error("✗ source maps must not ship"); fail++; }
if (!readdirSync(dist).includes("_headers")) { console.error("✗ dist/_headers missing"); fail++; }
if (!/Content-Security-Policy/.test(html)) { console.error("✗ CSP meta missing"); fail++; }
process.exit(fail ? 1 : 0);
