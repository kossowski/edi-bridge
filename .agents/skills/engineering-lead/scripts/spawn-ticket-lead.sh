#!/usr/bin/env bash
# Starts a ticket lead session for one ticket in a new herdr tab of this repo's workspace.
# Usage: spawn-ticket-lead.sh <ticket number> <lead session name>
set -euo pipefail
nn=$1
lead=$2
root=$(git rev-parse --show-toplevel)
name="ticket-$nn"
ws=$(herdr workspace list | jq -r --arg label "$(basename "$root")" \
  '.result.workspaces | (map(select(.label == $label)) + map(select(.focused)))[0].workspace_id')
r=$(herdr tab create --workspace "$ws" --cwd "$root" --label "$name" --env DISABLE_AUTO_UPDATE=true --no-focus)
sleep 3
pane=$(echo "$r" | jq -r '.result.root_pane.pane_id')
herdr agent start "$name" --kind claude --pane "$pane" --timeout 90000 -- --permission-mode auto >/dev/null
herdr agent prompt "$name" "/ticket-lead $nn . An engineering lead started you: session $lead. Send it your questions and reports with SendMessage and end your turn after each; its answers arrive as your next prompt." \
  | jq -c '.result.agent | {name, tab_id, agent_status}'
