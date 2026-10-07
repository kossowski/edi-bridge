# 36: Inbound webhook

**What to build:** External systems POST Documents to a webhook Channel, authenticated by the Channel's secret token and rate limited per Channel.

**Blocked by:** 31 (Runs from Manual Submission)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] A valid token creates a Run like any other Channel traffic
- [ ] Missing or wrong tokens are rejected
- [ ] Exceeding the per-Channel rate limit is rejected without affecting other Channels
