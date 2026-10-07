# 43: Sentry error monitoring

**What to build:** Defects (bugs, crashes) in web, api and worker are reported to Sentry, tagged with Workspace, Run and Trading Partner. Expected domain failures (typed Effect errors that become a Failure Stage) are never reported. Effect traces are exported to Sentry with sampling.

**Blocked by:** 31 (Runs from Manual Submission)

**Status:** ready-for-agent

- [ ] All three apps report unexpected errors to Sentry
- [ ] A Run failing on a broken partner Interchange produces no Sentry event (covered by a test)
- [ ] A defect inside a Run produces a Sentry event tagged with Workspace, Run and Trading Partner
- [ ] Traces follow a Run from receipt to delivery and are sampled (around 10–20%)
