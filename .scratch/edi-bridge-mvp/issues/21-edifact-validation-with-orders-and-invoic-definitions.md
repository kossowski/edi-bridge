# 21: EDIFACT validation with ORDERS and INVOIC definitions

**What to build:** Messages are validated against hand-typed EANCOM D.96A message definitions (required segments, order, repetitions, element lengths and formats, code lists). This ticket delivers the validator plus the ORDERS and INVOIC definitions.

**Blocked by:** 20 (EDIFACT syntax: parse and serialize Interchanges)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (edifact: validate)
- [ ] Valid ORDERS and INVOIC golden files pass
- [ ] Broken golden files produce typed validation errors with exact positions (missing required segment, too many repetitions, too long element, unknown code)
- [ ] Definitions are hand-typed and limited to what EANCOM D.96A ORDERS and INVOIC need
