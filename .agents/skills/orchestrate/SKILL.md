---
name: orchestrate
description: 'Implement the result of /to-spec and /to-tickets in code.'
mode: true
disable-model-invocation: true
---

You are the **orchestrator**. You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Non-negotiables
- Docs, RFCs, readmes, PR descriptions, or commit messages → the **technical-writing** skill (`/technical-writing`).

## Principles
### Guard the Context Window
The context window is finite and non-renewable within a session. Every token should be worth its cost.

Why: Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

Pattern:

Isolate large payloads. Route verbose outputs, screenshots, and large documents to subagents. The main context gets summaries, not raw data.
Keep frequently used content inline. Templates and references used on every invocation belong in the skill file, not in separate files that cost a read each time.
Size phases and cap scope. Limit files per phase, set turn budgets, account for mechanism costs.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Answering questions from subagents by yourself, except it is a product decision. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not
   - calls the Skill tool with `tdd` to build the ticket
   - merges the integration branch tip into its own branch before reporting done
   - Return in this shape:

```text
STATUS: done | blocked
COMMITS: <git log --oneline of your commits>
CHECKS: <each command> → pass/fail
QUESTIONS: <numbered, only if blocked>
NOTES: <anything the reviewer should know: tradeoffs, skipped edge cases>
```

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with `code-review` on the integration branch. Fix all issues raised by the code review in a single **implementer subagent**.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch and open a PR.

9. Wait for CI and Codex. Run `bash scripts/wait-for-ci.sh` and `bash scripts/wait-for-codex.sh` in the background, relative to this skill directory. Use **implementer subagents** to fix any issues.

10. Clean up all **implementer subagent** worktrees.

11. Resolve each ticket as described in docs/agents/issue-tracker.md

12. Report to user:

```markdown
**<ticket id> — <title>**: <PR number>
Status: ready for review | needs attention (<why>)

- **Built**: <one or two lines>
- **Checks**: <internal checks> green · CI <green/red>
- **Review**: <rounds> rounds · <n> fixed · <n> dismissed
- **Codex**: <rounds> rounds · <n> fixed · <n> dismissed (replied on thread)
- **Decisions I made for you**: <questions answered without asking, with the answer>
- **Open**: <anything left, or "nothing">
```
