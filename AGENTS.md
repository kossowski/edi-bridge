## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Commits

Conventional Commits, enforced by commitlint in the `commit-msg` hook. Fix the message when the hook rejects it; never bypass the hook.

- Format: `type(scope): subject`. The scope is required: the app or package folder name (e.g. `web`, `api`, `edifact`), or `repo` for root-level changes. Use the scope of the main change in a multi-package commit.
- English only, all lowercase, header at most 72 characters, imperative mood ("add", not "added").
- Use the vocabulary from `GLOSSARY.md` (e.g. "reprocess", not "rerun").
- A body is required: a short summary of what was done and why.
- Reference the ticket in a footer as `refs: edi-bridge-issue#<NN>` (the ticket number in `.scratch/<feature>/issues/`).

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Deployment docs

Public deployment guidance lives in `docs/deployment/`. Before working on this installation, read `.local/deployment/deployment.md` and `.local/deployment/deployment-operations.md` if they exist. The `.local/` directory is ignored by Git and excluded from Docker builds.

Keep actual hostnames, service names, tunnel identifiers, and installation-specific notes in `.local/deployment/`. Keep credentials in Dokploy or the secret manager. If private notes are missing, use the public guidance and request the missing installation details before changing the deployment.

## Code Review Rules

### Realistic triggers

- Flag a defect only when you can name the input, state, or sequence of steps that triggers it in the way this repository runs the code.
- Don't flag guards against states that no caller produces, such as more than 100 comments on a pull request or a server that accepts a connection and never answers.

### Development tooling

- Code under `.agents/`, `.claude/`, and `scripts/` is tooling that a person or an agent runs by hand. Flag only defects on the path that its `SKILL.md` or header comment documents.
- Don't flag hardening for that tooling against interrupts, unused flag combinations, or missing system dependencies.

### Follow-up commits

- When a commit fixes an earlier review finding, check that the fix is correct. Don't flag further edge cases in the same code unless they break the documented path.

### Strict areas

- In the `edifact` package and the mapping engine, flag edge cases too: malformed Interchanges, boundary values, and wrong error positions. Trading Partners send broken data, and the spec makes these packages test seams.

### Decisions already made

- Don't flag what the spec in `.scratch/` or an ADR in `docs/adr/` decided. For example, UI prototype screens get tests only after the UX is accepted, in ticket 19.
- Don't flag missing code comments or JSDoc. This repository keeps comments only for non-obvious reasons.
- Flag breaches of the process rules in `docs/agents/`, such as a ticket set to `done` without its resolution line.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
