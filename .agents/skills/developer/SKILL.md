---
name: developer
description: 'Implement one brief in a git worktree: test-first, verified with the repo checks, committed and reported. Use when a brief names a GOAL and a WORKTREE: a part of a ticket, review findings to fix, or a failed CI run to repair.'
---

You are the **developer** for one brief. It names a GOAL, a WORKTREE with its branch and parent, CONTEXT pointers (ticket, spec, stack file) and a SCOPE. Everything you do happens in that worktree. The main checkout and the other worktrees belong to the ticket lead who briefed you. Paths below are relative to the repo root; reach the worktree with `git -C <worktree>` and `pnpm -C <worktree>`.

## Rules

- **Read the pointers first**: the ticket, the spec and `GLOSSARY.md` entries for the area, and the stack file's scope for your part. The parts below yours are already on your branch, and later parts build what your scope leaves out. Work you find outside the scope goes into NOTES, not into the branch.
- **Build test-first**: call the Skill tool with `tdd`, unless the ticket sets another testing rule. Read `CODING_STANDARDS.md` before you write code; the reviewers hold you to it.
- **Verify in the worktree**: `pnpm -C <worktree> check:fast`, then `pnpm -C <worktree> check`, both green. Run each through the slot script, in the background, since it may wait for a slot:

  ```bash
  bash .agents/skills/developer/scripts/test-slot.sh pnpm -C <worktree> check
  ```

  The slot script is the machine's RAM budget: a full check peaks near 6 GB on an 11 GB VM, so two heavy commands run at once at most, and the second only when enough RAM is free. Every heavy command goes through it: check, test, lint, type check, build, vitest, Storybook, Playwright, and a dev server for a browser check. `pnpm install` does not.

- **Stop what you started**: every dev server, Storybook and background shell is gone before you report. Start and stop a dev server inside one slot command, so the slot frees itself when the check ends.
- **Commit** per `AGENTS.md`: one commit per concern, footer `refs: #<NN>`. Fix the message when the hook rejects it.
- **Questions**: answer technical ones from the code and the docs, and record the answer in NOTES. A product decision, or anything that blocks you, goes into QUESTIONS, and you stop with STATUS blocked.

## Report

End your turn with this report and nothing after it:

```text
STATUS     done | blocked
COMMITS    <git log --oneline <parent>..HEAD>
CHECKS     <each command> → pass | fail
QUESTIONS  <numbered, only when blocked>
NOTES      <answers you gave yourself, tradeoffs, work left to later parts>
```
