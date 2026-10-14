#!/usr/bin/env bash
# Lists the tickets a lead can start: the sub-issues of a spec, or the given tickets, each with its
# state, how many tickets it blocks, its area labels, whether a ticket lead session already runs
# for it, and the areas it shares with a running ticket. Runnable tickets come first, the ones
# that unblock the most others on top.
#
# Usage: scripts/board.sh <spec issue> | <ticket> [<ticket> ...]
set -euo pipefail
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fields='{number, title, state, labels: [.labels[].name], blocked_by: .issue_dependencies_summary.blocked_by, blocking: .issue_dependencies_summary.blocking}'

if (($# == 1)); then
  issues=$(gh api "repos/$repo/issues/$1/sub_issues?per_page=100" --jq "[.[] | $fields]")
  [[ $issues == "[]" ]] && issues=$(gh api "repos/$repo/issues/$1" --jq "[$fields]")
else
  issues=$(for n in "$@"; do gh api "repos/$repo/issues/$n" --jq "$fields"; done | jq -s .)
fi
running=$(herdr agent list 2>/dev/null | jq -c '[.result.agents[] | (.name // "") | select(startswith("ticket-")) | ltrimstr("ticket-")]' 2>/dev/null || echo '[]')

jq -r --argjson running "$running" '
  ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"] as $triage
  | map(. + {areas: [.labels[] | select(IN($triage[]) | not)], running: ((.number | tostring) as $n | ($running | index($n)) != null)})
  | ([.[] | select(.running) | .areas[]] | unique) as $busy
  | map(. + {
      status: (if .state != "open" then "closed"
               elif .running then "running"
               elif (.labels | index("ready-for-agent")) == null then (.labels | map(select(IN($triage[]))) | first // "no triage label")
               elif .blocked_by > 0 then "blocked by \(.blocked_by)"
               else "runnable" end),
      overlap: [.areas[] | select(IN($busy[]))]})
  | sort_by(.status != "runnable", -.blocking, .number)
  | def pad(n): . + (" " * (n - length) // "");
    .[] | "#\(.number | tostring | pad(4))  \(.status | pad(20))  blocks \(.blocking | tostring | pad(2))  \(.areas | join(",") | pad(22))  \(if (.overlap | length) > 0 then "overlaps " + (.overlap | join(",")) else "" end | pad(22))  \(.title)"
' <<<"$issues"
