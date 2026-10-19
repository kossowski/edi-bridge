# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..." --label <triage label> --label <area>`. Use a heredoc for multi-line bodies. A spec is a parent issue and its tickets are sub-issues.
- **Labels**: one triage label from `triage-labels.md`, plus one area label per app or package the ticket touches. Area labels are named like the commit scopes (`web`, `api`, `worker`, `contracts`, …, `repo`); a new package gets a new label.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number` or `node_id`). A ticket is unblocked when `issue_dependencies_summary.blocked_by` is `0`: it counts open blockers only.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close by hand**: only a ticket that no PR resolves, with `gh issue close <number> --reason completed` or `--reason "not planned"`. Every other ticket closes through its stack, as below.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

Commits and PRs before the move to GitHub reference tickets by their old local number, `edi-bridge-issue#<NN>`. Find that issue with `gh issue list --state all --search '"Migrated from ticket <NN>" in:body'`.

## Project board

The tickets sit on a GitHub Projects board with the columns Todo, In progress and Done. The board's own workflows move the cards: a new issue lands in Todo, a PR that links it moves it to In progress, and closing it moves it to Done. Leave the board to those workflows; the agents' token has no access to the project.

## When a skill says "close" or "resolve" a ticket

Work is delivered through a stack of PRs, the bottom one against `main`. Only a PR into `main` links and closes an issue.

1. The body of the bottom PR carries `Closes #<NN>`. The other PRs of the stack say `Part <k> of <n> of #<NN>`.
2. In the issue body, check every acceptance-criteria checkbox that the work fulfils. Don't change the wording.
3. Merging the stack closes the issue. Its linked PRs record where it was resolved, so it needs no closing comment.

A ticket carries no notes, causes, measurements or decisions: resolving it only ticks its checkboxes. Findings go into commit bodies and PR descriptions.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.
