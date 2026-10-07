# 45: Login, roles and invites

**What to build:** better-auth (email and password, no sign-up) runs in the api. The Operator creates invites for a Workspace with a role (Admin or Viewer) and copies the link; invited users set their password through it. Roles are enforced in the api and reflected in the UI. The fixed development Workspace is replaced by the logged-in user's Workspace.

**Blocked by:** 24 (Trading Partners live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] No sign-up path exists
- [ ] Invites are created by the Operator only and shared as copied links; no email is sent
- [ ] Viewers can read everything in their Workspace and change nothing (enforced in the api)
- [ ] Admins have full control inside their Workspace only
- [ ] The development Workspace shortcut is removed
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
