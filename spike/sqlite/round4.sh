#!/bin/bash
# One interleaved round of the round-4 bench: v2, a, b, ba in rotating order, with load snapshots before and after.
# Usage: spike/sqlite/round4.sh <round 1-5>
set -euo pipefail
R=$1
OUT=/tmp/ogs-sqlite-spike-data/r4
mkdir -p "$OUT"
ALL=(v2 a b ba)
RUN=()
if [ -S "${XDG_RUNTIME_DIR:-/run/user/1000}/bus" ]; then
  RUN=(systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=512M --)
fi
for ((i = 0; i < 4; i++)); do
  V=${ALL[$(((i + R - 1) % 4))]}
  { echo "== before $V round $R $(date +%T)"; uptime; ps -eo pcpu,rss,comm --sort=-pcpu | head -6; } > "$OUT/$V-$R.snap"
  "${RUN[@]}" node --no-warnings spike/sqlite/bench4.mjs "$V" "$OUT/$V-$R.json" > /dev/null || echo "FAILED $V $R"
  { echo "== after $V"; uptime; ps -eo pcpu,rss,comm --sort=-pcpu | head -6; } >> "$OUT/$V-$R.snap"
done
echo "round $R done"
