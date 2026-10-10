#!/usr/bin/env bash
# Deletes the /tmp leftovers that reviews and browser checks left for landed PRs.
#
# Usage: scripts/clean-tmp.sh <PR> [<PR> ...]
#
# Subagents name their scratch folders and files after the PR they check, e.g.
# /tmp/edi-pr23-review, /tmp/pr27-browser or /tmp/pr14-submission.png. /tmp is
# a tmpfs on this VM, so they hold RAM until deleted. Matches need a separator
# after the number, so PR 2 never matches pr23. Session scratchpads under
# /tmp/claude-* are never touched. Prints each deleted path and the space freed.
set -euo pipefail
shopt -s nullglob dotglob

(($# > 0)) || { echo "Usage: scripts/clean-tmp.sh <PR> [<PR> ...]" >&2; exit 2; }

paths=()
for pr in "$@"; do
  [[ $pr =~ ^[0-9]+$ ]] || { echo "Not a PR number: $pr" >&2; exit 2; }
  for path in /tmp/pr"$pr" /tmp/pr"$pr"[-_.]* /tmp/*-pr"$pr" /tmp/*-pr"$pr"[-_.]*; do
    [[ -e $path && $path != /tmp/claude-* ]] && paths+=("$path")
  done
done

if ((${#paths[@]} == 0)); then
  echo "Nothing to clean in /tmp."
  exit 0
fi

du -sch "${paths[@]}" | tail -1 | sed 's/\ttotal/ freed/'
printf 'deleted %s\n' "${paths[@]}"
rm -rf -- "${paths[@]}"
