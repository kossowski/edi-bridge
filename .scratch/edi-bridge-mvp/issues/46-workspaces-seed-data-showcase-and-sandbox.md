# 46: Workspaces, seed data, Showcase and Sandbox

**What to build:** The Operator creates Workspaces, optionally from seed data (fictional companies, GLNs from GS1's restricted-circulation prefixes 020–029 with valid check digits, Trading Partners, Mappings, Flows and traffic). The 'View live demo' button logs into a fixed Viewer of the Showcase Workspace without a form; the shared showcase-admin login is Admin of the Sandbox Workspace. The Operator resets the Sandbox to its seed on demand from the Operator area or a CLI command.

**Blocked by:** 45 (Login, roles and invites), 42 (Partner onboarding and Test Mode)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Workspace creation with and without seed
- [ ] All seeded GLNs use prefixes 020–029 and have valid check digits
- [ ] 'View live demo' logs into the Showcase Workspace as Viewer without a form
- [ ] Sandbox reset (UI and CLI) restores the seed and touches no other Workspace
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
