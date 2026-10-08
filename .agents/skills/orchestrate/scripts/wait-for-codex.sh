#!/usr/bin/env bash
# Asks Codex to review a pull request and waits for its answer.
#
# Usage: scripts/wait-for-codex.sh <PR> [focus]
#   scripts/wait-for-codex.sh 12
#   scripts/wait-for-codex.sh 12 for Tenant isolation issues
#
# Posts "@codex review [focus]", then waits up to 15 minutes for a review or
# comment from the Codex bot, or for "no findings": its 👍 reaction on the
# request or the pull request, or its summary comment marked Completed.
# Codex edits that summary comment in place from Running to Completed, so it
# never counts as an answer by itself. Exits 0 when Codex answered, 1 on timeout.
set -euo pipefail

pr=${1:?Usage: scripts/wait-for-codex.sh <PR> [focus]}
shift
focus=${*:-}

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
bot='chatgpt-codex-connector[bot]'
summary_marker='<!-- codex-pull-request-review-summary -->'

read -r request_id since < <(gh api "repos/$repo/issues/$pr/comments" \
  -f body="@codex review${focus:+ $focus}" --jq '"\(.id) \(.created_at)"')
echo "Requested Codex review on #$pr at $since (comment $request_id)."

completed_once=false
deadline=$((SECONDS + 15 * 60))
while ((SECONDS < deadline)); do
  sleep 30

  bot_comments=$(gh api "repos/$repo/issues/$pr/comments?since=$since&per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\")]")
  completed=$(jq --arg m "$summary_marker" \
    '[.[] | select(.body | contains($m)) | select(.body | test("Completed"))] | length' <<<"$bot_comments")
  comments=$(jq --arg m "$summary_marker" \
    '[.[] | select(.body | contains($m) | not)] | length' <<<"$bot_comments")
  reviews=$(gh api "repos/$repo/pulls/$pr/reviews?per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\" and .submitted_at > \"$since\")] | length")
  thumbs_up=0
  for reactions in "issues/comments/$request_id/reactions" "issues/$pr/reactions"; do
    count=$(gh api "repos/$repo/$reactions?per_page=100" \
      --jq "[.[] | select(.content == \"+1\" and .user.login == \"$bot\" and .created_at > \"$since\")] | length")
    thumbs_up=$((thumbs_up + count))
  done

  if ((reviews > 0 || comments > 0)); then
    echo "Codex answered with $reviews review(s) and $comments comment(s)."
    jq -r --arg m "$summary_marker" \
      '[.[] | select(.body | contains($m) | not)] | last | .body // "" | split("\n")[0]' <<<"$bot_comments"
    echo "Inline comments: gh api repos/$repo/pulls/$pr/comments"
    exit 0
  fi
  if ((thumbs_up > 0)); then
    echo "Codex reacted 👍: no findings."
    exit 0
  fi
  # The summary can flip to Completed a few seconds before the review is posted.
  if ((completed > 0)); then
    if [[ $completed_once == true ]]; then
      echo "Codex review completed: no findings."
      exit 0
    fi
    completed_once=true
  fi
done

echo "No answer from Codex after 15 minutes." >&2
exit 1
