#!/usr/bin/env bash
# Waits for the Codex review of a pull request.
#
# Usage: scripts/wait-for-codex.sh <PR>
#
# Codex reviews a pull request once, after the "@codex review" comment posted
# when the draft is marked ready. This only waits and never posts that comment.
# The answer is a review (findings), a "Reviewed commit" comment, or the
# summary comment marked Completed (no findings).
# Exits 0 when Codex answered, 1 after 15 minutes.
set -euo pipefail

pr=${1:?Usage: scripts/wait-for-codex.sh <PR>}

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
bot='chatgpt-codex-connector[bot]'
summary_marker='<!-- codex-pull-request-review-summary -->'

echo "Waiting for the Codex review of #$pr."
completed_once=false
deadline=$((SECONDS + 15 * 60))
while ((SECONDS < deadline)); do
  bot_comments=$(gh api --paginate "repos/$repo/issues/$pr/comments?per_page=100" \
    --jq ".[] | select(.user.login == \"$bot\")" | jq -s .)
  summary_row=$(jq -r --arg m "$summary_marker" \
    '[.[] | select(.body | contains($m))] | last | .body // "" | split("\n")[] | select(test("Code Review"))' \
    <<<"$bot_comments")
  answer=$(jq -r --arg m "$summary_marker" \
    '[.[] | select((.body | contains($m) | not) and (.body | contains("Reviewed commit")))] | last | .body // "" | split("\n") | .[0] // ""' \
    <<<"$bot_comments")
  reviews=$(gh api --paginate "repos/$repo/pulls/$pr/reviews?per_page=100" \
    --jq ".[] | select(.user.login == \"$bot\") | .id" | grep -c . || true)

  if ((reviews > 0)); then
    echo "Codex reviewed #$pr with $reviews review(s)."
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
      echo "Codex review of #$pr completed: no findings."
      exit 0
    fi
    completed_once=true
  fi

  sleep 30
done

echo "No answer from Codex after 15 minutes." >&2
exit 1
