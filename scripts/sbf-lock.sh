#!/usr/bin/env bash
# Produce a Cargo.lock that the Solana platform-tools toolchain (rustc/cargo
# 1.79 for Agave 2.1.x) can build. Modern cargo resolves newest semver-compatible
# crates, some of which are edition 2024 / MSRV > 1.79 and pulled in through
# loose requirements (e.g. blake3 1.8.x → digest 0.11 → block-buffer 0.12).
# We pin those back to the oldest version that still satisfies the dependents,
# then FAIL if anything in the tree still needs a newer compiler.
set -euo pipefail
MAX_RUST="${SBF_MAX_RUST:-1.79}"
[ -f Cargo.lock ] || cargo generate-lockfile

pin() { # pin <crate> <candidate versions ascending...>
  local c="$1"; shift
  grep -q "^name = \"$c\"$" Cargo.lock || return 0
  for v in "$@"; do
    if cargo update -p "$c" --precise "$v" >/dev/null 2>&1; then echo "pinned $c = $v"; return 0; fi
  done
  echo "::warning title=sbf-lock::could not pin $c to any of: $*"
}
pin blake3 1.5.5 1.6.0 1.6.1 1.7.0 1.8.0 1.8.1 1.8.2
pin indexmap 2.7.1 2.8.0 2.9.0 2.10.0
pin proc-macro-crate 3.2.0 3.3.0
pin toml_edit 0.22.24 0.22.26
pin hashbrown 0.15.2 0.15.3 0.15.4
pin getrandom 0.2.15 0.2.16

# Verify: every package must be edition ≤ 2021 and rust-version ≤ MAX_RUST.
BAD=$(cargo metadata --format-version 1 --locked 2>/dev/null | node -e '
  const max = process.argv[1].split(".").map(Number);
  const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const newer = (v) => { const a = v.split(".").map(Number); for (let i = 0; i < 2; i++) { if ((a[i]||0) !== (max[i]||0)) return (a[i]||0) > (max[i]||0); } return false; };
  const bad = m.packages.filter((p) => p.source && (p.edition === "2024" || (p.rust_version && newer(p.rust_version))));
  console.log(bad.map((p) => `${p.name}@${p.version}(ed${p.edition},msrv ${p.rust_version||"-"})`).join(" "));
' "$MAX_RUST")
if [ -n "$BAD" ]; then
  echo "::error title=sbf-lock::crates too new for platform-tools rust $MAX_RUST: $BAD"
  exit 1
fi
echo "sbf-lock: all crates build on rust $MAX_RUST"
