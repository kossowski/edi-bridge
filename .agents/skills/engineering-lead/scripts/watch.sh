#!/usr/bin/env bash
# Exits when the inbox holds a message (printed oldest first), a ticket lead sits on a permission prompt or swap passes SWAP_LIMIT_MB; otherwise a heartbeat after N seconds.
# Usage: watch.sh [seconds, default 5400]
budget="$(dirname "$0")/../../../machine.env"
[ -f "$budget" ] && . "$budget"
inbox=${AGENTS_INBOX:-$HOME/.agents/leads/inbox}
mkdir -p "$inbox/done"
end=$((SECONDS + ${1:-5400}))
while [ $SECONDS -lt $end ]; do
  msgs=$(find "$inbox" -maxdepth 1 -type f -name '[0-9]*.md' -printf '%f\n' | sort -t- -k2,2 -k1,1n)
  if [ -n "$msgs" ]; then
    for m in $msgs; do
      echo "=== $inbox/$m"
      cat "$inbox/$m"
      echo
    done
    exit 0
  fi
  swap=$(free -m | awk '/^Swap:/{print $3}')
  if [ "$swap" -gt "${SWAP_LIMIT_MB:-1500}" ]; then
    echo "MEMORY PRESSURE: swap ${swap}MB used, $(free -m | awk '/^Mem:/{print $7}')MB available"
    exit 0
  fi
  blocked=$(herdr agent list | jq -r '.result.agents[] | select((.name // "") | startswith("ticket-")) | select(.agent_status == "blocked") | .name')
  if [ -n "$blocked" ]; then
    for n in $blocked; do
      echo "$n BLOCKED"
      herdr agent read "$n" --source recent-unwrapped --lines 20 2>/dev/null | grep -v '^\s*$' | tail -15
    done
    exit 0
  fi
  sleep 15
done
echo "HEARTBEAT: RAM $(free -m | awk '/^Mem:/{print $7}')MB available"
herdr agent list | jq -r '.result.agents[] | select((.name // "") | startswith("ticket-")) | "\(.name) \(.tab_id) \(.agent_status)"'
