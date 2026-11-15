#!/bin/bash
# One interleaved round of the round-3 bench: each variant once, in a fixed rotating order, with a load snapshot
# (load average and top processes) before and after each run. Usage: spike/sqlite/round3.sh <round 1-5>
R=$1
OUT=/tmp/ogs-sqlite-spike-data/r3
mkdir -p "$OUT"
ALL=(v2 base a b c)
# rotate the order each round so no variant always runs first
for ((i = 0; i < 5; i++)); do
  V=${ALL[$(((i + R - 1) % 5))]}
  { echo "== before $V round $R $(date +%T)"; uptime; ps -eo pcpu,rss,comm --sort=-pcpu | head -6; } > "$OUT/$V-$R.snap"
  systemd-run --user --scope -q -p MemoryMax=2G node --no-warnings spike/sqlite/bench3.mjs "$V" "$OUT/$V-$R.json" > /dev/null || echo "FAILED $V $R"
  { echo "== after $V"; uptime; ps -eo pcpu,rss,comm --sort=-pcpu | head -6; } >> "$OUT/$V-$R.snap"
done
echo "round $R done"
