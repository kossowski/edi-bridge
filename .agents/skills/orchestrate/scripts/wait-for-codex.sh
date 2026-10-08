#!/usr/bin/env bash
# Waits for the Codex review of a pull request's latest commit.
#
# Usage: scripts/wait-for-codex.sh <PR> [focus]
#   scripts/wait-for-codex.sh 12
#   scripts/wait-for-codex.sh 12 for Tenant isolation issues
#
# Codex reviews pushes on its own, so this only waits. When no review of the
# head commit has started after 3 minutes, it posts "@codex review [focus]"
# once. It follows the pull request's head like wait-for-ci.sh. The answer is
# a review on the head commit (findings), a "Reviewed commit" comment, or the
# summary comment marked Completed for the head commit (no findings).
# Exits 0 when Codex answered, 1 after 15 minutes.
set -euo pipefail

pr=${1:?Usage: scripts/wait-for-codex.sh <PR> [focus]}
shift
focus=${*:-}

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
bot='chatgpt-codex-connector[bot]'
summary_marker='<!-- codex-pull-request-review-summary -->'
grace=$((3 * 60))

head=''
deadline=$((SECONDS + 15 * 60))
while ((SECONDS < deadline)); do
  sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
  if [[ $sha != "$head" ]]; then
    head=$sha
    short=${head:0:7}
    head_seen_at=$SECONDS
    requested=false
    completed_once=false
    echo "Waiting for the Codex review of $short on #$pr."
  fi

  bot_comments=$(gh api "repos/$repo/issues/$pr/comments?per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\")]")
  summary_row=$(jq -r --arg m "$summary_marker" \
    '[.[] | select(.body | contains($m))] | last | .body // "" | split("\n")[] | select(test("Code Review"))' \
    <<<"$bot_comments" | grep -F "\`$short" || true)
  answer=$(jq -r --arg m "$summary_marker" --arg s "\`$short" \
    '[.[] | select((.body | contains($m) | not) and (.body | contains("Reviewed commit")) and (.body | contains($s)))] | last | .body // "" | split("\n") | .[0] // ""' \
    <<<"$bot_comments")
  reviews=$(gh api "repos/$repo/pulls/$pr/reviews?per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\" and .commit_id == \"$head\")] | length")

  if ((reviews > 0)); then
    echo "Codex reviewed $short with $reviews review(s)."
    echo "Inline comments: gh api repos/$repo/pulls/$pr/comments"
    exit 0
  fi
  if [[ -n $answer ]]; then
    echo "$answer"
    exit 0
  fi
  # The summary can flip to Completed a few seconds before the review is posted.
  if [[ $summary_row == *Completed* ]]; then
    if [[ $completed_once == true ]]; then
      echo "Codex review of $short completed: no findings."
      exit 0
    fi
    completed_once=true
  fi

  if [[ -z $summary_row && $requested == false ]] && ((SECONDS - head_seen_at >= grace)); then
    gh api "repos/$repo/issues/$pr/comments" -f body="@codex review${focus:+ $focus}" --silent
    requested=true
    echo "No review of $short started within $((grace / 60)) minutes. Requested one."
  fi

  sleep 30
done

echo "No answer from Codex after 15 minutes." >&2
exit 1
