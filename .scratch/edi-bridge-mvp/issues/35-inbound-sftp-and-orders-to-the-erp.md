# 35: Inbound SFTP and ORDERS to the ERP

**What to build:** The worker polls inbound SFTP Channels at each Channel's interval. A received ORDERS Interchange is split into one Run per Message; each is mapped to the ERP's Document Structure and delivered by HTTP POST on an outbound HTTP Channel. One bad Message does not block the others.

**Blocked by:** 32 (Outbound SFTP delivery), 28 (Mapping engine: inbound)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline; SFTP via Testcontainers, polling driven by Effect's test clock)
- [ ] Polling respects the per-Channel interval (default one minute)
- [ ] An Interchange with three Messages yields three Runs linked to the Interchange
- [ ] If one Message fails mapping, the other two are still delivered
- [ ] Outbound HTTP delivery failures fail the Run at the delivery stage
