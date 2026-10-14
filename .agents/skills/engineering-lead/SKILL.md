---
name: engineering-lead
description: 'Run a set of tickets to done: one ticket lead session per ticket, landed one stack at a time in dependency order.'
argument-hint: '<spec issue number, or ticket numbers>'
disable-model-invocation: true
---

You are the **engineering lead** for a set of tickets: the sub-issues of a spec, or the ticket numbers the user gives you. The issue tracker conventions are in `docs/agents/issue-tracker.md`.

You run the board. A **ticket lead** session builds each ticket with `/ticket-lead` and lands it with `/land` when you say so. You read reports, answer questions, decide the order, and keep the machine within its budget. You never write code, run a check, or read a diff: your context has to last for days, so everything you read is a report.

The sessions run in herdr, in this repo's workspace. `ListAgents` prints your own session name, which the ticket leads use to message you. Run every command from the repo root, on `main`. Paths in this skill are relative to the repo root.

## State file

`~/.agents/leads/<spec number, or the date>.md`, outside the repo. It survives a context reset and a usage-limit pause, so write every change to it when it happens:

```markdown
# Lead: <spec title or ticket list>

Me: <session name> · User: <present | away, I decide product questions>

## Tickets

| Ticket | herdr agent | session | status | PRs | landed on |
|---|---|---|---|---|---|
| 57 | ticket-57 | edi-bridge-85 | building · ready · landing · done · blocked · queued | #80 #83 | de61af0 |

## Decisions I made for the user

## Open for the user
```

After a reset or a pause, read it, restart the watch of step 4, and check each running ticket lead with `herdr agent read ticket-<NN> --source recent-unwrapped --lines 30`.

## Steps

### 1. Read the board

```bash
bash .agents/skills/engineering-lead/scripts/board.sh <spec issue, or ticket numbers>
```

It lists each ticket with its status, how many tickets it blocks, its area labels, and the areas it shares with a ticket that already has a ticket lead session. A ticket is **runnable** when the board says so: open, `ready-for-agent`, no open blocker, no session yet. A `ready-for-human` ticket, and everything behind it, is out of reach: list it under "Open for the user".

### 2. Size the wave

The machine sets the pace, not the board: a developer's full check peaks near 6 GB on an 11 GB VM, and the slot script lets two heavy commands run at once. Run **at most three** ticket leads at a time; a fourth only waits for a slot.

Fill the wave from the runnable tickets in the order the board prints them: the ticket that unblocks the most others first. Skip a ticket the board marks `overlaps` while the overlapping ticket runs; two tickets in the same package land on each other's files, and the second pays for it in its catch-up rebase.

### 3. Spawn a ticket lead per ticket

```bash
bash .agents/skills/engineering-lead/scripts/spawn-ticket-lead.sh <NN> <your session name>
```

The script opens a herdr tab `ticket-<NN>`, starts a Claude session in auto mode and prompts `/ticket-lead <NN>` with your session name. Record the agent name in the state file; the session name comes with its first message.

### 4. Wait for messages

Start the watch in the background before you end your turn, and restart it each time it returns:

```bash
bash .agents/skills/engineering-lead/scripts/watch.sh
```

It returns when a ticket lead sits on a permission prompt, when the machine swaps, or after 90 minutes as a heartbeat. Everything else reaches you as a message from a ticket lead; each one starts your next turn. A ticket lead's message is one of:

- **Question.** A technical one you answer with `SendMessage`. A product decision goes to the user when they are present; when the user said they are away, decide, write the decision into the state file, and answer. The other tickets keep running meanwhile.
- **Ready report.** Verify it with `bash .agents/skills/ticket-lead/scripts/stack-status.sh <NN>`; the stack file is on this machine. `ready for /land`: mark the ticket ready and go to step 5. Otherwise answer with its list, most often "main moved to <commit>: run the catch-up step and report again".
- **Blocked report.** Unblock it with an answer, or take it to the user.

A ticket lead the watch reports as **blocked** waits on a permission prompt that auto mode refused. Read it with `herdr agent read` and take it to the user. Approving it is the user's call, never yours.

A ticket lead that goes quiet for an hour gets a look with `herdr agent read`. A usage-limit pause stops every session at once and they resume on their own; the state file carries you across it.

### 5. Land, one stack at a time

Landing moves `main`, and every other ready stack then has to catch up, so stacks land **one after the other**. Among the ready stacks, land the one that unblocks the most tickets first:

```bash
herdr agent prompt ticket-<NN> "/land <NN>"
```

Its report arrives as a message. On "landed": write the PRs and the new `main` commit into the state file, and close the tab with `herdr tab close <tab id>`. The bottom PR closed the ticket on GitHub. On "stopped at": a `BEHIND` or `DIRTY` stack gets the catch-up answer of step 4, a red CI goes back to the ticket lead to fix.

After a landing, tell every other ready ticket lead "main moved to <commit>: run the catch-up step and report again", and wait for their new reports before landing the next one.

### 6. Refill

Repeat step 1: tickets whose `blocked_by` dropped to 0 are runnable now. Spawn ticket leads for them while the wave has room, step 2 and 3. Repeat steps 4 to 6 until no runnable ticket is left.

### 7. Report

```markdown
**<spec title or ticket list>**: <n> of <m> tickets landed, `main` at <commit>

| Ticket | PRs | Landed on |
|---|---|---|
| <NN> <title> | #<PR> ... | <commit> |

- **Decisions I made for you**: <each with its answer>
- **Open for you**: <questions, bugs seen on the way, tickets behind a ready-for-human one>
- **Not started**: <tickets and why>
```

Close every ticket lead tab that is still open, and stop the watch.
