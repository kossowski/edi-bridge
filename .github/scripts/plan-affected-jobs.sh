#!/usr/bin/env bash
set -euo pipefail

jobs=$(jq -c . <<<"$MATRIX")

if [ "$EVENT_NAME" != pull_request ] || ! git diff --quiet "origin/$BASE_REF...HEAD" -- .github; then
  echo "matrix=$jobs" >>"$GITHUB_OUTPUT"
  exit 0
fi

turbo_version=$(jq -r .devDependencies.turbo package.json)
selected='[]'

while read -r entry; do
  read -ra tasks <<<"$(jq -r .tasks <<<"$entry")"
  plan=$(npx --yes "turbo@$turbo_version" run "${tasks[@]}" --affected --dry=json)
  count=$(jq '[.tasks[] | select(.command != "<NONEXISTENT>")] | length' <<<"$plan")
  echo "$(jq -r .name <<<"$entry"): $count affected tasks"
  if [ "$count" -gt 0 ]; then
    selected=$(jq -c --argjson entry "$entry" '. + [$entry]' <<<"$selected")
  fi
done < <(jq -c '.[]' <<<"$jobs")

if [ "$selected" = '[]' ]; then
  selected='[{"name":"No affected tasks","skip":true}]'
fi

echo "matrix=$selected" >>"$GITHUB_OUTPUT"
