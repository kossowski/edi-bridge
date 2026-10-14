# Shared by the ticket lead scripts: reads a stack file and snapshots CI. Source it, don't run it.
#
# parse_stack <NN> fills PARTS (k), BRANCHES, PRS ("-" when none) and WORKTREES, and sets TITLE.
# ci_snapshot <sha> prints "green", "red", "pending" or "none" for the pull_request runs on a commit.
# A cancelled run counts as superseded when a run of the same workflow on the same commit succeeded:
# GitHub cancels the duplicate run per PR after a stack push.

stack_file() { echo "$HOME/.agents/stacks/$1.md"; }

parse_stack() {
  local nn=$1 file line k rest branch pr
  file=$(stack_file "$nn")
  [[ -f $file ]] || { echo "No stack file $file" >&2; return 2; }
  TITLE=$(sed -n '1s/^# [0-9]*: //p' "$file")
  PARTS=() BRANCHES=() PRS=() WORKTREES=()
  while IFS= read -r line; do
    [[ $line =~ ^([0-9]+)\.\ (.*)$ ]] || continue
    k=${BASH_REMATCH[1]} rest=${BASH_REMATCH[2]}
    branch=$(awk -F' \\| ' '{print $2}' <<<"$rest" | xargs)
    pr=$(awk -F' \\| ' '{print $3}' <<<"$rest" | sed -n 's/^PR: *#\{0,1\}//p' | xargs)
    [[ -n $branch ]] || { echo "Part $k has no branch in $file" >&2; return 2; }
    PARTS+=("$k") BRANCHES+=("$branch") PRS+=("${pr:--}")
    WORKTREES+=("$(git rev-parse --show-toplevel)/../edi-bridge-worktrees/$nn-$k")
  done <"$file"
  ((${#PARTS[@]} > 0)) || { echo "No parts in $file" >&2; return 2; }
}

parent_of() { # <index> → ref of the parent branch
  local i=$1
  ((i == 0)) && echo origin/main || echo "${BRANCHES[i - 1]}"
}

ci_snapshot() {
  local sha=$1 repo runs
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
  runs=$(gh api "repos/$repo/actions/runs?head_sha=$sha&event=pull_request&per_page=100" \
    --jq '[.workflow_runs[] | {id, workflow_id, status, conclusion}]')
  ci_classify "$runs"
}

ci_classify() { # <runs json> → green | red | pending | none
  jq -r '
    . as $all
    | [ $all[] | . as $r
        | select((.conclusion == "cancelled"
                  and ([$all[] | select(.workflow_id == $r.workflow_id and .conclusion == "success")] | length) > 0) | not) ] as $live
    | if ($all | length) == 0 then "none"
      elif ([$live[] | select(.status != "completed")] | length) > 0 then "pending"
      elif ([$live[] | select(.conclusion != "success")] | length) > 0 then "red"
      else "green" end' <<<"$1"
}
