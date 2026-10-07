#!/usr/bin/env bash
# Waits for the CI runs on a pull request's latest commit.
#
# Usage: scripts/wait-for-ci.sh <PR>
#
# The GitHub token cannot read check runs, so this uses the Actions API. It
# follows the pull request's head: when a new commit is pushed while waiting,
# it waits for that commit's runs instead. Prints each job's result. Exits 0
# when every run succeeded, 1 when one failed, 2 after 20 minutes.
set -euo pipefail

pr=${1:?Usage: scripts/wait-for-ci.sh <PR>}
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

deadline=$((SECONDS + 20 * 60))
while ((SECONDS < deadline)); do
  sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
  runs=$(gh api "repos/$repo/actions/runs?head_sha=$sha&event=pull_request&per_page=100" \
    --jq '[.workflow_runs[] | {id, status, conclusion}]')

  total=$(jq length <<<"$runs")
  pending=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")

  if ((total > 0 && pending == 0)); then
    echo "CI on #$pr at ${sha:0:7}:"
    for id in $(jq -r '.[].id' <<<"$runs"); do
      gh api "repos/$repo/actions/runs/$id/jobs?per_page=100" \
        --jq '.jobs[] | "  \(.name): \(.conclusion)"'
    done
    failed=$(jq '[.[] | select(.conclusion != "success")] | length' <<<"$runs")
    ((failed == 0)) && exit 0
    echo "Failed runs: gh run view <id> --log-failed ($(jq -r '[.[] | select(.conclusion != "success") | .id] | join(", ")' <<<"$runs"))" >&2
    exit 1
  fi

  sleep 30
done

echo "CI on #$pr did not finish within 20 minutes." >&2
exit 2
