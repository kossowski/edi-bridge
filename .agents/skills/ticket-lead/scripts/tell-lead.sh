#!/usr/bin/env bash
# Writes a message from stdin into the engineering lead's inbox in one step and prints its path.
# Usage: tell-lead.sh <NN> <question|report|blocked> <<'EOF' ... EOF
set -euo pipefail
nn=${1:?Usage: tell-lead.sh <NN> <question|report|blocked>}
kind=${2:?Usage: tell-lead.sh <NN> <question|report|blocked>}
[[ $kind == question || $kind == report || $kind == blocked ]] || { echo "kind is question, report or blocked" >&2; exit 2; }
inbox=${AGENTS_INBOX:-$HOME/.agents/leads/inbox}
mkdir -p "$inbox/done"
tmp=$(mktemp "$inbox/.$nn-XXXXXX")
cat >"$tmp"
[[ -s $tmp ]] || { rm -f "$tmp"; echo "empty message on stdin" >&2; exit 2; }
while :; do
  file="$inbox/$nn-$(date -u +%Y%m%dT%H%M%S.%3NZ)-$kind.md"
  [[ -e $file ]] && { sleep 1; continue; }
  mv "$tmp" "$file"
  break
done
echo "$file"
