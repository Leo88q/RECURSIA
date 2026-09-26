// Supply-chain guard: fail CI if the lockfile contains a known-compromised
// package version (e.g. the Dec 2024 @solana/web3.js 1.95.6/1.95.7 backdoor
// that exfiltrated private keys), or any dependency resolved outside the
// public npm registry (tarball/git URLs can bypass integrity pinning).
import { readFileSync } from "node:fs";

const BAD = {
  "@solana/web3.js": ["1.95.6", "1.95.7"],
  "solana-transaction-toolkit": ["*"],        // typosquat key stealers
  "solana-stable-web-huks": ["*"],
  "@kodane/patch-manager": ["*"],
};
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const problems = [];
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
  const bad = BAD[name];
  if (bad && (bad.includes("*") || bad.includes(meta.version))) problems.push(`${name}@${meta.version} (${path})`);
  if (meta.resolved && !meta.link && !meta.resolved.startsWith("https://registry.npmjs.org/")) problems.push(`non-registry source: ${path} → ${meta.resolved}`);
  if (meta.resolved && !meta.link && !meta.integrity) problems.push(`missing integrity hash: ${path}`);
}
if (problems.length) { console.error("supply-chain check FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`supply-chain check: clean (${Object.keys(lock.packages).length} lock entries)`);
