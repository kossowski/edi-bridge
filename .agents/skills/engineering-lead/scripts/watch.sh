#!/usr/bin/env bash
# Exits when the inbox holds a message (printed oldest first, with the age of the oldest and a STALE line past
# WATCH_STALE_MINUTES), a ticket lead newly sits on a permission prompt or swap passes SWAP_LIMIT_MB; otherwise a
# heartbeat after N seconds. Run it as it is: it loops by itself, and every return is an event to act on.
# Usage: watch.sh [seconds, default 5400]
budget="$(dirname "$0")/../../../machine.env"
[ -f "$budget" ] && . "$budget"
inbox=${AGENTS_INBOX:-$HOME/.agents/leads/inbox}
stale_min=${WATCH_STALE_MINUTES:-30} poll=${WATCH_POLL_SECONDS:-15}
# A blocked agent is reported once per block, so a restarted watch does not return at once for the same prompt.
seen="$inbox/.blocked-reported"
mkdir -p "$inbox/done"
touch "$seen"
notify() { herdr notification show "$1" --body "$2" --sound request >/dev/null 2>&1 || true; }
end=$((SECONDS + ${1:-5400}))
while [ $SECONDS -lt $end ]; do
  msgs=$(find "$inbox" -maxdepth 1 -type f -name '[0-9]*.md' -printf '%f\n' | sort -t- -k2,2 -k1,1n)
  if [ -n "$msgs" ]; then
    now=$(date +%s) oldest='' oldest_age=0
    for m in $msgs; do
      echo "=== $inbox/$m"
      cat "$inbox/$m"
      echo
      age=$(((now - $(stat -c %Y "$inbox/$m")) / 60))
      if [ "$age" -ge "$oldest_age" ]; then oldest=$m oldest_age=$age; fi
    done
    echo "INBOX: $(echo "$msgs" | wc -l) message(s), oldest $oldest ${oldest_age} min"
    if [ "$oldest_age" -ge "$stale_min" ]; then
      echo "STALE: $oldest unanswered for $oldest_age min"
      notify "Lead inbox: STALE" "$oldest unanswered for $oldest_age min"
    fi
    exit 0
  fi
  swap=$(free -m | awk '/^Swap:/{print $3}')
  if [ "${swap:-0}" -gt "${SWAP_LIMIT_MB:-1500}" ]; then
    echo "MEMORY PRESSURE: swap ${swap}MB used, $(free -m | awk '/^Mem:/{print $7}')MB available"
    exit 0
  fi
  blocked=$(herdr agent list | jq -r '.result.agents[] | select((.name // "") | startswith("ticket-")) | select(.agent_status == "blocked") | .name')
  new=$(comm -23 <(echo "$blocked" | sed '/^$/d' | sort) <(sort "$seen"))
  echo "$blocked" | sed '/^$/d' | sort >"$seen"
  if [ -n "$new" ]; then
    for n in $new; do
      echo "$n BLOCKED"
      herdr agent read "$n" --source recent-unwrapped --lines 20 2>/dev/null | sed '/^\s*$/d' | tail -15
    done
    notify "Lead: ticket lead blocked" "$(echo $new) waits on a permission prompt"
    exit 0
  fi
  sleep "$poll"
done
echo "HEARTBEAT: RAM $(free -m | awk '/^Mem:/{print $7}')MB available, inbox empty"
herdr agent list | jq -r '.result.agents[] | select((.name // "") | startswith("ticket-")) | "\(.name) \(.tab_id) \(.agent_status)"'
