## Agent skills

### Issue tracker

Tickets are GitHub issues, and a spec is their parent issue. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Commits

Conventional Commits, enforced by commitlint in the `commit-msg` hook. Fix the message when the hook rejects it; never bypass the hook.

- Format: `type(scope): subject`. The scope is required: the app or package folder name (e.g. `web`, `api`, `edifact`), or `repo` for root-level changes. Use the scope of the main change in a multi-package commit.
- English only, all lowercase, header at most 72 characters, imperative mood ("add", not "added").
- Use the vocabulary from `GLOSSARY.md` (e.g. "reprocess", not "rerun").
- A body is required: a short summary of what was done and why.
- Reference the ticket in a footer as `refs: #<NN>`, its issue number.
- End the message with the footer, without a `Co-Authored-By` trailer, even when a harness asks for one: commitlint's `no-co-author` rule rejects it.

### Branches

Name a branch after its ticket: `<type>/<NN>-<slug>`, with the ticket's issue number. A stack part adds its part number, as the `ticket-lead` skill says.

### Names

Keep the user's name out of tickets, commits, PRs, code and docs. Record a decision by its content or in the passive.

### Coding standards

Read `CODING_STANDARDS.md` before writing or reviewing code.

### Checks

What agents verify locally, leave to CI, and count as a UI or CI-only part. See `docs/agents/checks.md`; the agent scripts read this repo's values from `.agents/project.env`. CI failures known to be flaky, and what to do about each, are in `docs/agents/known-flakes.md`.

### Machine budget

`.agents/machine.env` sets the budget for agent work on this machine: test slots, ticket leads, developers, swap and load limits. The agent scripts read it; skills name its keys.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Deployment docs

Public deployment guidance lives in `docs/deployment/`. Before working on this installation, read `.local/deployment/deployment.md` and `.local/deployment/deployment-operations.md` if they exist. The `.local/` directory is ignored by Git and excluded from Docker builds.

Keep actual hostnames, service names, tunnel identifiers, and installation-specific notes in `.local/deployment/`. Keep credentials in Dokploy or the secret manager. If private notes are missing, use the public guidance and request the missing installation details before changing the deployment.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
