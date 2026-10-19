#!/usr/bin/env bash
# Rebases every part of a ticket's stack onto its parent, bottom to top, and pushes with lease.
# Part 1 goes onto origin/main, part k onto the branch of part k-1. A part already on its parent
# is skipped, so after a conflict (resolve it, git rebase --continue) the same call finishes the rest.
# The rebase starts at the fork point, so a part rewritten below (a conflict fix) does not replay
# its old commits into the part above.
#
# Usage: scripts/catch-up.sh <NN> [--from <k>]
#
# --from <k> leaves the parts below k alone, for a fix in part k that the parts above must follow.
# Exits 0 when every part is on its parent and pushed, 1 at a conflict or a dirty worktree.
set -euo pipefail
source "$(dirname "$0")/stack-lib.sh"

nn=${1:?Usage: scripts/catch-up.sh <NN> [--from <k>]}
from=1
[[ ${2:-} == --from ]] && from=${3:?--from needs a part number}
parse_stack "$nn"
git fetch --quiet origin

for i in "${!PARTS[@]}"; do
  k=${PARTS[i]} branch=${BRANCHES[i]} wt=${WORKTREES[i]}
  ((k < from)) && continue
  parent=$(parent_of "$i")
  [[ -d $wt ]] || { echo "part $k: worktree $wt is missing" >&2; exit 1; }
  gitdir=$(git -C "$wt" rev-parse --absolute-git-dir)
  if [[ -d $gitdir/rebase-merge || -d $gitdir/rebase-apply ]]; then
    echo "part $k: a rebase is in progress in $wt; finish it with git rebase --continue, then run this again" >&2; exit 1
  fi
  if [[ -n $(git -C "$wt" status --porcelain) ]]; then
    echo "part $k: $wt has uncommitted changes" >&2; exit 1
  fi
  if git -C "$wt" merge-base --is-ancestor "$parent" "$branch"; then
    echo "part $k: already on $parent"
  else
    echo "part $k: rebasing $branch onto $parent"
    if ! git -C "$wt" rebase --quiet --fork-point "$parent"; then
      echo "part $k: conflict in $wt" >&2
      git -C "$wt" diff --name-only --diff-filter=U >&2
      exit 1
    fi
  fi
  if [[ $(git -C "$wt" rev-parse HEAD) != $(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null) ]]; then
    git -C "$wt" push --quiet --force-with-lease origin "$branch"
    echo "part $k: pushed $(git -C "$wt" rev-parse --short HEAD)"
  fi
done
echo "stack #$nn is on origin/main $(git rev-parse --short origin/main); wait for CI on every PR"
