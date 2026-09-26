#!/usr/bin/env node
// Checklist #76: fail the build if any source file contains invisible /
// bidi-control Unicode that could hide instructions from human or AI review.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EXT = new Set([".rs", ".ts", ".tsx", ".js", ".mjs", ".json", ".toml", ".md", ".yml", ".yaml", ".html", ".css"]);
const SKIP = new Set(["node_modules", "target", "dist", ".git", ".anchor", "test-ledger"]);
const BAD = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]|[\u{E0000}-\u{E007F}]/u;
// Files that intentionally contain such characters as test data (escaped in source is fine).
let failures = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(extname(name))) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((l, i) => {
        const m = l.match(BAD);
        if (m) { failures++; console.error(`${p}:${i + 1}: invisible char U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`); }
      });
    }
  }
}
walk(process.cwd());
if (failures) { console.error(`\n${failures} invisible/bidi characters found`); process.exit(1); }
console.log("unicode check: clean");
