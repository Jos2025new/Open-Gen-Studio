#!/bin/bash
# Capped runs for the engine comparison (Tarea 2). Every browser and server runs inside a systemd unit with
# MemoryMax=1800M and no swap, so an overrun kills only that unit, never the user's session.
# usage: browser-scope.sh serve <engine> | open <url> | kill
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "${1:-}" in
  serve)
    systemd-run --user --unit="ogs-rb-http-$2-$(date +%s)" --collect -q -p MemoryMax=1800M -p MemorySwapMax=0 -- python3 -m http.server 5190 --bind 127.0.0.1 -d "$ROOT/.bench-dist/$2" ;;
  open)
    # A fresh daemon must be started by this unit; otherwise it inherits another cgroup (the app's) and escapes the cap.
    "$0" kill >/dev/null
    systemd-run --user --unit="ogs-rb-browser-$(date +%s)" --collect -q -p MemoryMax=1800M -p MemorySwapMax=0 -p KillMode=none -- agent-browser --session ogs-render-bench --headed --executable-path /opt/brave.com/brave/brave --args "--ozone-platform=x11,--js-flags=--expose-gc" open "$2" ;;
  kill)
    # Stops only bench browsers: their agent-browser daemons and the Chrome processes running with an agent-browser profile.
    for p in $(pgrep -f "[a]gent-browser-linux"); do kill "$p" 2>/dev/null; done
    for p in $(pgrep -f "[b]rave.com/brave/brave"); do tr '\0' '\n' < /proc/$p/cmdline 2>/dev/null | grep -q "agent-browser-chrome" && kill -9 "$p" 2>/dev/null; done ;;
  *) echo "usage: $0 serve <engine> | open <url> | kill"; exit 2 ;;
esac
