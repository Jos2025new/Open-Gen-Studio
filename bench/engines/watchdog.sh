#!/bin/bash
# Memory watchdog for bench browsers (no systemd: Chromium leaves a transient unit's cgroup). Once a second it sums the
# RSS of the processes whose command line has this session's agent-browser profile (--user-data-dir=/tmp/agent-browser-chrome-*)
# and watches MemAvailable. Over 1800 MB of those processes, or under 1500 MB available: kills only them (and their
# agent-browser daemon), writes the reason to the log, and exits. Also exits when no such process is left.
# usage: watchdog.sh [log]   Start it before opening the browser; it waits up to 120 s for one, and never starts a browser.
LOG="${1:-/tmp/claude-1000/watchdog.log}"
PROFILE_RE='agent-browser-chrome-'
mkdir -p "$(dirname "$LOG")"
pids() { ps -eo pid=,args= | awk -v re="$PROFILE_RE" 'index($0, re) && /user-data-dir/ {print $1}'; }
daemons() { pgrep -f "agent-browser/bin/agent-browser-linux[-]x64" || true; }
rss_mb() { local t=0 p; for p in $(pids); do r=$(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null); t=$((t + ${r:-0})); done; echo $((t / 1024)); }
avail_mb() { awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo; }
echo "$(date +%T) watchdog start" >> "$LOG"
seen=0; waited=0
while true; do
  list=$(pids)
  if [ -z "$list" ]; then
    if [ $seen -eq 1 ]; then echo "$(date +%T) no bench browser left; exit" >> "$LOG"; exit 0; fi
    waited=$((waited + 1)); [ $waited -ge 120 ] && { echo "$(date +%T) no bench browser appeared in 120 s; exit" >> "$LOG"; exit 0; }
    sleep 1; continue
  fi
  seen=1
  rss=$(rss_mb); av=$(avail_mb)
  if [ "$rss" -gt 1800 ] || [ "$av" -lt 1500 ]; then
    echo "$(date +%T) KILL rss=${rss}MB available=${av}MB (limits 1800 MB / 1500 MB)" >> "$LOG"
    for p in $list; do kill -9 "$p" 2>/dev/null; done
    for d in $(daemons); do kill "$d" 2>/dev/null; done
    exit 2
  fi
  sleep 1
done
