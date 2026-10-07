# 30: Channels and Flows live

**What to build:** Channels (inbound SFTP with polling interval, inbound webhook, outbound SFTP, outbound HTTP) and Flows are stored via the real api. Channel secrets are encrypted at rest and never returned in full. Flows are pinned to a Mapping Version and moved to a newer one only explicitly.

**Blocked by:** 24 (Trading Partners live), 29 (Mappings live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Secrets are encrypted in Postgres and masked in every response
- [ ] Webhook Channels get a generated secret token that can be regenerated
- [ ] A Flow references exactly one Message Type, Trading Partner, inbound Channel, Mapping Version and destination Channel
- [ ] Moving a Flow to a newer Mapping Version is an explicit operation
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
