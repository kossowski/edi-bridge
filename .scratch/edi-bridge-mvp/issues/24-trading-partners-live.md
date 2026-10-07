# 24: Trading Partners live

**What to build:** Trading Partners and the Workspace's company identity are stored and served by the real api. This first backend slice also establishes the db package (Drizzle, migrations, every table scoped to a Workspace), a fixed development Workspace used until login exists (ticket 45), and the Effect core basics, including the helper that turns a failed Zod parse into a tagged Effect error.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes via Fastify request injection)
- [ ] Create, read, update Trading Partners and the company identity (GLN validated)
- [ ] Every table carries the Workspace; data of one Workspace is never visible to another (covered by a test with two Workspaces)
- [ ] The api resolves a fixed development Workspace until ticket 45 replaces it
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
