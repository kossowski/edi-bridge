# 70: Operator area: cards and Workspace tabs

**What to build:** `/operator` shows Workspaces as cards grouped by kind (Customers, Showcase, Sandbox), each kind explained in one sentence, with documents today and last activity; creating a Workspace asks its name and whether to start with example data, then points to inviting its first member. A Workspace's page has tabs: Overview, Members & invites (members with role, invites with a copyable link valid for 7 days, revoke), Limits (retention days and AI budget, explained by their effect) and Danger zone (reset to example data, Sandbox only, with confirmation). Reference: `/lab/operator` and `/lab/operator/[workspace-id]` on `feat/19-ux-lab`.

**Blocked by:** 69 (Settings in tab categories)

**Status:** done

- [x] Cards are grouped by kind and show the listed facts; empty kinds say so
- [x] Creating a Workspace offers the example-data option and leads to Members & invites
- [x] Invites are created with Admin or Viewer role and shared as a copied link; no email is sent; invites can be revoked
- [x] Limits are edited here and explained by their effect (for example "0 turns the AI helper off")
- [x] Reset is offered only for Sandbox Workspaces and asks for confirmation
- [x] The Workspace and invite contracts gain members, revoke and activity facts; the live API follows in tickets 45 and 46
- [x] The current Operator screens and their stories are replaced; tests stay green
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #87, #88, #95, #98.
