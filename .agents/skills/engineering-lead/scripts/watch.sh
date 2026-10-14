#!/usr/bin/env bash
# Exits when a ticket lead sits on a permission prompt or the machine swaps; otherwise a heartbeat after N seconds.
# Usage: watch.sh [seconds, default 5400]
end=$((SECONDS + ${1:-5400}))
while [ $SECONDS -lt $end ]; do
  swap=$(free -m | awk '/^Swap:/{print $3}')
  if [ "$swap" -gt 1500 ]; then
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
  sleep 60
done
echo "HEARTBEAT: RAM $(free -m | awk '/^Mem:/{print $7}')MB available"
herdr agent list | jq -r '.result.agents[] | select((.name // "") | startswith("ticket-")) | "\(.name) \(.tab_id) \(.agent_status)"'
