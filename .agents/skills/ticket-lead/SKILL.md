---
name: ticket-lead
description: 'Build one ticket as a stack of small PRs, ready for /land.'
disable-model-invocation: true
---

You are the **ticket lead** for one ticket. The user, or an engineering lead session, gives you its issue number. The issue tracker conventions are in `docs/agents/issue-tracker.md`.

The goal is the ticket built as a **stack**: a few small PRs, each based on the branch of the PR before it, linked as a GitHub stacked PR, each green in CI and reviewed. You stop when the stack is ready. The user, or the lead, merges it with `/land`.

You plan, brief, review, and run every `git`, `gh`, and `gh stack` command that creates, pushes, or rebases a branch, opens a PR, or links the stack. **Implementer subagents** write code and commit in the worktree you give them, nothing else.

Run every command from the repo root, the main checkout, and keep it on `main`. Reach a worktree with `git -C <worktree>` and `pnpm -C <worktree>`, and give subagents its absolute path. Paths in this skill are relative to the repo root.

Communicate with subagents through **context pointers**: the ticket, the spec, the stack file, the parent branch. Don't paste what a pointer already reaches.

## Names

- **Ticket**: the GitHub issue `#<NN>`. `<NN>` below is its issue number.
- **Part**: one PR of the stack, numbered `1` to `n` from the bottom.
- **Branch**: `<type>/<NN>-<k>-<part-slug>`, where `<type>` is the commit type of the part and `<k>` the part number. Example: `feat/11-1-source-and-target-trees`.
- **Parent**: the branch of part `k-1`. The parent of part 1 is `origin/main`.
- **Worktree**: `../edi-bridge-worktrees/<NN>-<k>`, next to the repo root.
- **Stack file**: `~/.agents/stacks/<NN>.md`, the plan and the PR numbers. It lives outside the repo and survives a context reset.

## Steps

### 1. Read

Read the ticket, its spec (the parent issue), and the `GLOSSARY.md` entries and ADRs for the area. Every blocker of the ticket is closed: `issue_dependencies_summary.blocked_by` is `0`. If one is open, tell the user and stop.

### 2. Plan the stack

Decide for this ticket how to split it into parts. The ticket as a whole is the vertical slice; a part only has to hold on its own. Each part:

- passes lint, type check, tests, and build on its own
- is safe on `main` before the parts above it exist
- shows its own evidence for the Evidence section of the `pr` skill
- has a scope that fits in one to three items: what it covers and what it leaves to later parts

Order the parts so the stack reads as an argument: each part makes the one above it easy to review. Every acceptance criterion names the part that completes it. A ticket that is one change stays one part.

Write the stack file:

```markdown
# <NN>: <ticket title>

Ticket: <ticket path>

1. <part title> | <branch> | PR: - | Completes criteria: <criterion numbers, or none>
   Scope: <what this part covers; what it leaves to later parts>
2. ...
```

Show the plan to the user in one short message and continue without waiting.

When a part turns out to hold two changes while you build it, narrow its scope to the first change and add a new part above it for the second. Update the stack file. Work already committed stays in the part where it landed.

### 3. Build each part, bottom to top

Finish one part before starting the next: PR open, linked, and CI green.

**a. Create the worktree.**

```bash
git fetch origin
git worktree add -b <branch> ../edi-bridge-worktrees/<NN>-<k> <parent>
pnpm -C ../edi-bridge-worktrees/<NN>-<k> install --frozen-lockfile
```

**b. Implement.** Spawn a fresh implementer subagent with this brief:

```text
GOAL       Part <k> of ticket <NN>: <part title>.
WORKTREE   <absolute worktree path>, branch <branch>. Work and commit only here.
CONTEXT    Ticket #<NN>, spec #<parent>, stack file <path>. Parts below are already on this branch.
SCOPE      The scope of part <k> in the stack file. Later parts build what it leaves out.
BUILD      Call the Skill tool with `tdd`, unless the ticket sets another testing rule.
VERIFY     pnpm check:fast first, then pnpm check, both green in the worktree.
CLEANUP    Stop every dev server and Storybook you started before you report.
COMMITS    Conventional Commits per AGENTS.md, footer `refs: #<NN>`.
REPORT     STATUS: done | blocked
           COMMITS: <git log --oneline <parent>..HEAD>
           CHECKS: <each command> → pass/fail
           QUESTIONS: <numbered, only if blocked>
           NOTES: <tradeoffs, skipped edge cases>
```

Answer a subagent's questions yourself, unless the answer is a product decision. Ask the user for those, and record the other answers for the report.

**c. Review.** Call the Skill tool with `code-review`, fixed point `<parent>`, in the worktree. If the part changes what renders (components, routes, styles or i18n messages in `apps/web` or `packages/ui`), run a **browser-check subagent** in parallel that calls the Skill tool with `browser-check` against the worktree and keeps the screenshots in its own context. Give all findings you accept to one fresh implementer subagent in the same worktree.

**d. Open the PR and link the stack.**

```bash
git -C ../edi-bridge-worktrees/<NN>-<k> push -u origin <branch>
gh pr create --base <parent branch name, `main` for part 1> --head <branch> \
  --title "<type>(<scope>): <subject>" --body-file <body file>
```

- The title follows the commit header rules in `AGENTS.md`. It becomes the squash commit header.
- Write the body with the `pr` skill into a file in your scratchpad. It starts with `Part <k> of <n> of #<NN>`. The body of part 1 also carries `Closes #<NN>`, so merging the stack closes the ticket.
- Open the PR ready for review, not as a draft. `gh stack merge` does not merge drafts.
- Write the PR number into the stack file.

From part 2 on, link every PR of the ticket so far, bottom to top:

```bash
gh stack link <PR of part 1> <PR of part 2> ... <PR of part k>
```

The first call creates the stack on GitHub, later calls add the new PR to it. PRs already in the stack are kept. Don't use `gh stack init`, `add`, `submit`, `checkout`, or `sync`: the worktrees hold the branches, and these commands want to check them out or create PRs themselves.

**e. Wait for CI.** Run this in the background:

```bash
bash .agents/skills/ticket-lead/scripts/wait-for-ci.sh <PR> $(git -C <worktree> rev-parse HEAD)
```

The commit makes the script wait until GitHub shows the push. Without it, the script can report the previous commit's CI. If CI fails, a fresh implementer subagent fixes it in the worktree. Then `git -C <worktree> push`, and wait again.

### 4. Resolve the ticket

Resolve the ticket as `docs/agents/issue-tracker.md` describes. The step is done when every acceptance criterion the stack fulfils is checked in the issue body.

### 5. Catch up with main

```bash
git fetch origin
git merge-base --is-ancestor origin/main <branch of part 1>
```

When the check fails, `main` moved since part 1 branched. Rebase each part onto its parent, bottom to top:

```bash
git -C <worktree> rebase <parent>
git -C <worktree> push --force-with-lease
```

Resolve conflicts yourself; take a product decision to the user. Then run `pnpm -C <top worktree> check:fast` and wait for CI on every PR as in step 3e. The step is done when `origin/main` is an ancestor of part 1's branch and every PR is green.

### 6. Report

Stop every background shell, monitor and subagent you started, and delete the screenshots in your scratchpad. Keep all worktrees until `/land` has merged the stack.

When another agent started you, such as a lead session, also send it the report with `SendMessage`, so it needs no polling.

```markdown
**<NN> — <ticket title>**: stack of <n> PRs on `main` <short commit>, ready for `/land`

| Part | PR | Lines | CI | Review |
|---|---|---|---|---|
| 1 <title> | #<PR> | +<a> −<d> | green | <n> fixed · <n> dismissed |

- **Browser**: <routes checked> · <n> fixed · <n> dismissed, or "no UI change"
- **Decisions I made for you**: <questions answered without asking, with the answer>
- **Open**: <anything left, or "nothing">
```

## Fix a lower part

When a finding belongs to the code of an earlier part, fix it there, not in the part you are working on:

1. A fresh implementer subagent fixes and commits in the lower part's worktree.
2. `git -C <lower worktree> push`
3. For each higher part in order, bottom to top:

```bash
git -C <worktree> rebase <branch of the part below>
git -C <worktree> push --force-with-lease
```

Wait for CI on every PR you pushed, as in step 3e. The stack on GitHub needs no change: its PRs and bases stay the same.
