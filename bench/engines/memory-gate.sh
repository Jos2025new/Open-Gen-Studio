#!/bin/bash
# Waits until at least 1200 MB are available for two consecutive checks. Run before opening the browser and before every measurement.
ok=0
for i in $(seq 1 600); do
  a=$(free -m | awk 'NR==2{print $7}')
  if [ "$a" -ge 1200 ]; then ok=$((ok+1)); else ok=0; fi
  if [ $ok -ge 2 ]; then echo "GATE_OK avail=${a}MB $(date +%T)"; exit 0; fi
  sleep 3
done
echo "GATE_TIMEOUT avail=$(free -m | awk 'NR==2{print $7}')MB"; exit 1
