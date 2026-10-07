# 28: Mapping engine: inbound

**What to build:** The mapping engine also maps an EDIFACT Message to a Document matching a Document Structure (e.g. ORDERS → ERP JSON or CSV).

**Blocked by:** 27 (Mapping engine: outbound), 22 (DESADV and CONTRL definitions)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (mapping engine)
- [ ] A golden ORDERS maps to the expected JSON and CSV Documents
- [ ] Repeating segment groups map to arrays/rows
- [ ] Typed mapping errors as for outbound
