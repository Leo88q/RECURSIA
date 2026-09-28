#!/usr/bin/env bash
# Nightly deep fuzz of the compiled program (checklist #54): both stateful fuzzers,
# several fresh seeds, long walks. Every failing seed is published as an annotation
# with the exact command to reproduce it locally; all seeds run even if one fails.
#   FUZZ_SEEDS  space-separated seeds (default: 6 seeds derived from today's date)
#   FUZZ_STEPS  steps per walk (default 1500)
set -u
export FORCE_COLOR=0 NO_COLOR=1
cd "$(dirname "$0")/../tests/chain"
steps="${FUZZ_STEPS:-1500}"
base=$(( $(date -u +%Y%m%d) * 100 ))
seeds="${FUZZ_SEEDS:-$base $((base + 1)) $((base + 2)) $((base + 3)) $((base + 4)) $((base + 5))}"
failed=0
for seed in $seeds; do
  for file in test/fuzz.test.ts test/fuzz-surface.test.ts; do
    echo "=== $file seed=$seed steps=$steps"
    if FUZZ_SEED="$seed" FUZZ_STEPS="$steps" REQUIRE_SO=1 npx vitest run --pool=forks "$file" > /tmp/fuzz-out.txt 2>&1; then
      cov=$(grep -m1 -oE "(surface|money) fuzz seed [0-9]+: .*" /tmp/fuzz-out.txt | cut -c1-900)
      echo "ok ${cov}"
    else
      failed=1
      msg=$(grep -E "Error|step [0-9]+|Program log|expected" /tmp/fuzz-out.txt | head -40 | cut -c1-300)
      msg="reproduce: cd tests/chain && FUZZ_SEED=$seed FUZZ_STEPS=$steps REQUIRE_SO=1 npx vitest run --pool=forks $file"$'\n'"$msg"
      msg="${msg//'%'/'%25'}"; msg="${msg//$'\r'/'%0D'}"; msg="${msg//$'\n'/'%0A'}"
      echo "::error title=fuzz $file seed $seed::${msg}"
    fi
  done
done
exit $failed
