#!/usr/bin/env bash
# Asks Codex to review a pull request and waits for its answer.
#
# Usage: scripts/wait-for-codex.sh <PR> [focus]
#   scripts/wait-for-codex.sh 12
#   scripts/wait-for-codex.sh 12 for Tenant isolation issues
#
# Posts "@codex review [focus]", then waits up to 15 minutes for a review or
# comment from the Codex bot, or its 👍 reaction on the request (no findings).
# Exits 0 when Codex answered, 1 on timeout.
set -euo pipefail

pr=${1:?Usage: scripts/wait-for-codex.sh <PR> [focus]}
shift
focus=${*:-}

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
bot='chatgpt-codex-connector[bot]'

read -r request_id since < <(gh api "repos/$repo/issues/$pr/comments" \
  -f body="@codex review${focus:+ $focus}" --jq '"\(.id) \(.created_at)"')
echo "Requested Codex review on #$pr at $since (comment $request_id)."

deadline=$((SECONDS + 15 * 60))
while ((SECONDS < deadline)); do
  sleep 30

  reviews=$(gh api "repos/$repo/pulls/$pr/reviews?per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\" and .submitted_at > \"$since\")] | length")
  comments=$(gh api "repos/$repo/issues/$pr/comments?since=$since&per_page=100" \
    --jq "[.[] | select(.user.login == \"$bot\")] | length")
  thumbs_up=$(gh api "repos/$repo/issues/comments/$request_id/reactions" \
    --jq "[.[] | select(.content == \"+1\" and .user.login == \"$bot\")] | length")

  if ((reviews > 0 || comments > 0)); then
    echo "Codex answered with $reviews review(s) and $comments comment(s)."
    echo "Inline comments: gh api repos/$repo/pulls/$pr/comments"
    exit 0
  fi
  if ((thumbs_up > 0)); then
    echo "Codex reacted 👍: no findings."
    exit 0
  fi
done

echo "No answer from Codex after 15 minutes." >&2
exit 1
