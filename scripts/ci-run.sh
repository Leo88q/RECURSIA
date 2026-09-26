#!/usr/bin/env bash
# Run a command; on failure publish the log tail as a GitHub annotation so it
# is readable through the checks API (no blob-storage access needed).
set -o pipefail
title="$1"; shift
"$@" 2>&1 | tee /tmp/ci-out.txt
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  msg=$(grep -E "^(error|warning)|-->|^\s+\||panicked|FAIL|✗|Error" /tmp/ci-out.txt | head -c 20000)
  [ -z "$msg" ] && msg=$(tail -c 20000 /tmp/ci-out.txt)
  msg="${msg//'%'/'%25'}"; msg="${msg//$'\r'/'%0D'}"; msg="${msg//$'\n'/'%0A'}"
  echo "::error title=${title}::${msg}"
fi
exit $code
