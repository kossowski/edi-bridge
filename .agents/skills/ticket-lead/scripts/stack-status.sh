#!/usr/bin/env bash
# Prints the state of a ticket's stack from its stack file: for each part the PR, its base, merge
# state, CI and whether the worktree is pushed; then whether origin/main is an ancestor of part 1.
#
# Usage: scripts/stack-status.sh <NN>
#
# Exits 0 when the stack is ready for /land, 1 when something is not ready, 2 on a missing stack file.
set -euo pipefail
source "$(dirname "$0")/stack-lib.sh"

nn=${1:?Usage: scripts/stack-status.sh <NN>}
parse_stack "$nn"
git fetch --quiet origin
problems=()

echo "#$nn ${TITLE:-} — ${#PARTS[@]} part(s)"
for i in "${!PARTS[@]}"; do
  k=${PARTS[i]} branch=${BRANCHES[i]} pr=${PRS[i]} wt=${WORKTREES[i]}
  expected_base=$([[ $i == 0 ]] && echo main || echo "${BRANCHES[i - 1]}")
  if [[ $pr == - ]]; then
    echo "$k  $branch  no PR yet"; problems+=("part $k has no PR"); continue
  fi
  read -r state draft base merge head < <(gh pr view "$pr" --json state,isDraft,baseRefName,mergeStateStatus,headRefOid \
    --jq '"\(.state) \(.isDraft) \(.baseRefName) \(.mergeStateStatus) \(.headRefOid)"')
  ci=$(ci_snapshot "$head")
  if [[ -d $wt ]]; then
    local_head=$(git -C "$wt" rev-parse HEAD)
    [[ $local_head == "$head" ]] && pushed=pushed || pushed="UNPUSHED (${local_head:0:7} local)"
  else
    pushed="no worktree"
  fi
  echo "$k  $branch  #$pr  base $base  $merge  CI $ci  $pushed"
  [[ $state == OPEN ]] || problems+=("#$pr is $state")
  [[ $draft == false ]] || problems+=("#$pr is a draft")
  [[ $base == "$expected_base" ]] || problems+=("#$pr targets $base, expected $expected_base")
  [[ $merge == CLEAN ]] || problems+=("#$pr merge state $merge")
  [[ $ci == green ]] || problems+=("#$pr CI $ci")
  [[ $pushed == pushed || $pushed == "no worktree" ]] || problems+=("part $k worktree is ahead of its PR")
done

main_sha=$(git rev-parse --short origin/main)
if git merge-base --is-ancestor origin/main "origin/${BRANCHES[0]}" 2>/dev/null; then
  echo "main: part 1 contains origin/main $main_sha"
else
  echo "main: origin/main moved to $main_sha, part 1 does not contain it"
  problems+=("stack is behind origin/main $main_sha")
fi

if ((${#problems[@]} == 0)); then
  echo "ready for /land"
else
  echo "not ready:"; printf '  - %s\n' "${problems[@]}"; exit 1
fi
