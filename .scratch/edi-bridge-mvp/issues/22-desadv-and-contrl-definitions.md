# 22: DESADV and CONTRL definitions

**What to build:** The edifact package also validates DESADV and CONTRL, completing all MVP Message Types.

**Blocked by:** 21 (EDIFACT validation with ORDERS and INVOIC definitions)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (edifact: validate)
- [ ] Valid and broken DESADV and CONTRL golden files behave as for ORDERS and INVOIC
- [ ] CONTRL can reference an Interchange by its control reference (needed for Acknowledgements)
