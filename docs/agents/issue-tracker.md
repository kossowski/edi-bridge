# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## When a skill says "close" or "resolve" a ticket

Work is delivered through a PR against `main`. Merging a PR doesn't close anything here; the ticket file is updated by hand:

1. Check every acceptance-criteria checkbox that the work fulfils. Don't change the wording.
2. Set the `Status:` line to `done`.
3. Append a line under `## Comments`: `Resolved in #<PR number> (<integration branch>).`

Commits reference the ticket with the `refs: edi-bridge-issue#<NN>` footer.
