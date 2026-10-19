#!/usr/bin/env bash
# Waits for the CI runs on a pull request's latest commit.
#
# Usage: scripts/wait-for-ci.sh <PR> [<pushed commit>]
#
# The GitHub token cannot read check runs, so this uses the Actions API. It
# follows the pull request's head: when a new commit is pushed while waiting,
# it waits for that commit's runs instead. Right after a push, GitHub can
# still report the previous head for a while; pass the pushed commit to wait
# until the head has moved to it. Prints each job's result. Exits 0 when every
# run succeeded, 1 when one failed, 2 after 10 minutes. A cancelled run does not
# count when a run of the same workflow on the same commit succeeded: GitHub
# cancels the duplicate run per PR after a stack push. A cancelled run without
# such a twin is printed with how to re-run it.
set -euo pipefail
source "$(dirname "$0")/stack-lib.sh"

pr=${1:?Usage: scripts/wait-for-ci.sh <PR> [<pushed commit>]}
pushed=${2:+$(git rev-parse --verify "$2^{commit}")}
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

deadline=$((SECONDS + 10 * 60))
while ((SECONDS < deadline)); do
  sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
  if [[ -n $pushed && $sha != "$pushed" ]]; then
    sleep 10
    continue
  fi
  pushed=
  runs=$(gh api "repos/$repo/actions/runs?head_sha=$sha&event=pull_request&per_page=100" \
    --jq '[.workflow_runs[] | {id, workflow_id, status, conclusion}]')

  state=$(ci_classify "$runs")

  if [[ $state == green || $state == red ]]; then
    echo "CI on #$pr at ${sha:0:7}:"
    for id in $(jq -r '.[].id' <<<"$runs"); do
      gh api "repos/$repo/actions/runs/$id/jobs?per_page=100" \
        --jq '.jobs[] | "  \(.name): \(.conclusion)"'
    done
    [[ $state == green ]] && exit 0
    echo "Failed runs: gh run view <id> --log-failed ($(jq -r '[.[] | select(.conclusion != "success") | .id] | join(", ")' <<<"$runs"))" >&2
    cancelled=$(jq -r '. as $all | [.[] | . as $r | select(.conclusion == "cancelled" and ([$all[] | select(.workflow_id == $r.workflow_id and .conclusion == "success")] | length) == 0) | .id] | join(" ")' <<<"$runs")
    [[ -n $cancelled ]] && echo "Cancelled without a green twin: $cancelled. Re-run each with gh run rerun <id> and wait again; a 403 means the token lacks Actions write access: tell the user." >&2
    exit 1
  fi

  sleep 30
done

echo "CI on #$pr did not finish within 10 minutes." >&2
exit 2
