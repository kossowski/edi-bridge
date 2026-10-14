---
name: land
description: "Merge a ticket's PR stack into main in one step."
disable-model-invocation: true
---

The user gives you a ticket number `<NN>`. `/ticket-lead` built its PRs as a **stack**, listed in the stack file `~/.agents/stacks/<NN>.md` with their branches and worktrees (`../edi-bridge-worktrees/<NN>-<k>`).

Run every command from the repo root, the main checkout, on `main`. Reach a worktree with `git -C <worktree>`. Paths in this skill are relative to the repo root.

Running `/land` is the go of the user, or of the engineering lead, to merge the whole stack. GitHub merges it in one all-or-nothing operation: every PR lands, or none does.

## 1. Check the stack

```bash
gh pr list --state open --json number,title,headRefName,baseRefName,isDraft \
  --jq '.[] | "#\(.number) \(.headRefName) → \(.baseRefName) draft=\(.isDraft)"'
```

The open PRs of ticket `<NN>` match the stack file: the bottom PR targets `main`, each PR above it targets the branch of the one below, and none is a draft. If they don't match, report the difference and stop.

```bash
gh pr view <bottom PR> --json mergeStateStatus --jq .mergeStateStatus
```

When it is `BEHIND` or `DIRTY`, `main` moved past the stack: report that the stack needs the catch-up step of `/ticket-lead`, and stop.

## 2. Check CI on every PR

For each PR, bottom to top:

```bash
bash .agents/skills/ticket-lead/scripts/wait-for-ci.sh <PR>
```

Every run exits 0. If one doesn't, stop.

## 3. Merge

For a stack of two or more PRs, name the top PR. GitHub merges it and every PR below it, bottom first, one squash commit per PR:

```bash
gh stack merge <top PR> --yes --squash
```

For a single PR: `gh pr merge <PR> --squash`.

Then confirm:

```bash
git fetch origin --prune
git log --oneline -<n> origin/main
```

The log shows one commit per part, titled like its PR, in stack order. If `gh stack merge` failed, nothing was merged: report its error and stop.

## 4. Clean up

For each part:

```bash
git worktree remove ../edi-bridge-worktrees/<NN>-<k>
git branch -D <branch>
```

Then:

```bash
gh stack unstack --local <stack number>
git pull --ff-only
```

Skip `unstack` for a single PR. Take the stack number from `gh stack view --short` or the PR page. Delete the stack file.

Last, free the RAM in `/tmp`, a tmpfs here: the leftovers of the reviews and browser checks of these PRs, and Node's compile cache, which Node rebuilds on its own:

```bash
bash .agents/skills/land/scripts/clean-tmp.sh <PR> ...
```

Pass every landed PR number. Add the deleted paths and the space freed to the report.

## Report

```markdown
**<NN> — <ticket title>**: <landed n PRs | nothing landed>

- **Landed**: #<PR> <title>, ...
- **Stopped at**: <check and reason>, or "nothing, stack complete"
- **/tmp**: <space freed and deleted paths>, or "nothing to clean"
```

When an engineering lead prompted `/land`, also send it the report with `SendMessage`.
