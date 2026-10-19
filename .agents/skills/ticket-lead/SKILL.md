---
name: ticket-lead
description: 'Build one ticket as a stack of small PRs, ready for /land.'
disable-model-invocation: true
---

You are the **ticket lead** for one ticket. The user, or an engineering lead session, gives you its issue number. The issue tracker conventions are in `docs/agents/issue-tracker.md`.

The goal is the ticket built as a **stack**: a few small PRs, each based on the branch of the PR before it, linked as a GitHub stacked PR, each green in CI and reviewed. You stop when the stack is ready. The user, or the lead, merges it with `/land`.

You plan, brief, review, and run every `git`, `gh`, and `gh stack` command that creates, pushes, or rebases a branch, opens a PR, or links the stack. **Developer subagents** write code and commit in the worktree you give them, nothing else; each one follows the `developer` skill. The **reviewers** are the `code-review` and `browser-check` skills.

Run every command from the repo root, the main checkout, and keep it on `main`. Reach a worktree with `git -C <worktree>` and `pnpm -C <worktree>`, and give subagents its absolute path. Paths in this skill are relative to the repo root.

Communicate with subagents through **context pointers**: the ticket, the spec, the stack file, the parent branch. Don't paste what a pointer already reaches.

When an engineering lead started you, its prompt names its session. Write each question and report into its inbox, as `question`, `report`, or `blocked` when you stop on a blocker:

```bash
bash .agents/skills/ticket-lead/scripts/tell-lead.sh <NN> <question|report|blocked> <<'EOF'
<message>
EOF
```

Then you may nudge it with a one-line `SendMessage` naming the file, one try at most; the file is the message. End your turn, and its answer arrives as your next prompt. Without an engineering lead, questions and reports go to the user.

## Names

- **Ticket**: the GitHub issue `#<NN>`. `<NN>` below is its issue number.
- **Part**: one PR of the stack, numbered `1` to `n` from the bottom.
- **Branch**: `<type>/<NN>-<k>-<part-slug>`, where `<type>` is the commit type of the part and `<k>` the part number. Example: `feat/11-1-source-and-target-trees`.
- **Parent**: the branch of part `k-1`. The parent of part 1 is `origin/main`.
- **Worktree**: `../edi-bridge-worktrees/<NN>-<k>`, next to the repo root.
- **Stack file**: `~/.agents/stacks/<NN>.md`, the plan and the PR numbers. It lives outside the repo and survives a context reset.

## Steps

### 1. Read

Read the ticket, its spec (the parent issue), and the `GLOSSARY.md` entries and ADRs for the area. Every blocker of the ticket is closed: `issue_dependencies_summary.blocked_by` is `0`. If one is open, tell whoever started you and stop.

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

**b. Implement.** Spawn a fresh developer subagent with this brief:

```text
GOAL      Part <k> of ticket <NN>: <part title>.
WORKTREE  <absolute worktree path>, branch <branch>, parent <parent>.
CONTEXT   Ticket #<NN>, spec #<parent issue>, stack file <path>.
SCOPE     Part <k> in the stack file.
Call the Skill tool with `developer`.
```

A fix subagent, for review findings or a red CI, gets the same brief with the findings, or the failed run's id and task, as GOAL.

Answer a developer's questions yourself, unless the answer is a product decision. Take those to whoever started you, and record the other answers for the report.

**c. Review.** Skip the review and the browser check for a part that is **tiny** or **CI-only**, and write `skipped (tiny)` or `skipped (ci-only)` into the report's Review column:

- **Tiny**: at most 20 insertions plus deletions in `git -C <worktree> diff --shortstat <parent>...HEAD -- . ':(exclude)pnpm-lock.yaml'`, generated files left out too, and no new behaviour: no new branch, route, endpoint, message or test case.
- **CI-only**: every changed file is under `.github/` or `.husky/`, or is a config file at the repo root.

Otherwise call the Skill tool with `code-review`, fixed point `<parent>`, in the worktree. If the part changes what renders (components, routes, styles or i18n messages in `apps/web` or `packages/ui`), run a **browser-check subagent** in parallel that calls the Skill tool with `browser-check` against the worktree, starts its dev server through `.agents/skills/developer/scripts/test-slot.sh`, and keeps the screenshots in its own context. Give the blocking findings you accept to one fresh developer subagent in the same worktree. A non-blocking finding goes into the report under Open; pass it on with the blocking ones only when its fix is trivial and inside the part's scope.

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

The commit makes the script wait until GitHub shows the push. Without it, the script can report the previous commit's CI. If CI fails, a fresh developer subagent fixes it in the worktree. Then `git -C <worktree> push`, and wait again.

### 4. Resolve the ticket

Resolve the ticket as `docs/agents/issue-tracker.md` describes. The step is done when every acceptance criterion the stack fulfils is checked in the issue body.

### 5. Catch up with main

```bash
bash .agents/skills/ticket-lead/scripts/catch-up.sh <NN>
```

It rebases each part onto its parent, bottom to top, and pushes with lease; a part already on its parent is skipped. At a conflict it names the worktree and the files: resolve them, `git -C <worktree> rebase --continue`, and run it again. Take a product decision to whoever started you. Then wait for CI on every PR as in step 3e. The step is done when the script reports the stack on `origin/main` and every PR is green.

### 6. Report

Stop every background shell, monitor and subagent you started, run `bash .agents/skills/developer/scripts/stop-leftovers.sh` for the servers a developer forgot, and delete the screenshots in your scratchpad. Keep all worktrees until `/land` has merged the stack.

```bash
bash .agents/skills/ticket-lead/scripts/stack-status.sh <NN>
```

The report goes out when it prints `ready for /land`. Otherwise fix what it lists first.

When an engineering lead started you, write the report into its inbox as `report` and end your turn. It answers what is open and tells you when to land by prompting `/land <NN>` into your session.

```markdown
**<NN> — <ticket title>**: stack of <n> PRs on `main` <short commit>, ready for `/land`

| Part | PR | Lines | CI | Review |
|---|---|---|---|---|
| 1 <title> | #<PR> | +<a> −<d> | green | <n> fixed · <n> dismissed · <n> open, or skipped (tiny), skipped (ci-only) |

- **Browser**: <routes checked> · <n> fixed · <n> dismissed · <n> open, or "no UI change"
- **Decisions I made for you**: <questions answered without asking, with the answer>
- **Open**: <non-blocking findings left unfixed, with part and file; anything else left, or "nothing">
```

## Fix a lower part

When a finding belongs to the code of an earlier part, fix it there, not in the part you are working on:

1. A fresh developer subagent fixes and commits in the lower part's worktree.
2. `git -C <lower worktree> push`
3. `bash .agents/skills/ticket-lead/scripts/catch-up.sh <NN> --from <k+1>`, where `<k>` is the fixed part: it rebases every part above onto the one below it and pushes with lease.

Wait for CI on every PR you pushed, as in step 3e. The stack on GitHub needs no change: its PRs and bases stay the same.
