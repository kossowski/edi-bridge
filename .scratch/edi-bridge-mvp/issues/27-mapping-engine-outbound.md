# 27: Mapping engine: outbound

**What to build:** The mapping engine applies a Mapping Version to a JSON or CSV Document and produces an EDIFACT Message, using every transform in the catalogue (constant, concatenate, split, substring, date format, number format, Lookup Table, conditional, loop over line items) and JSONata as the escape hatch. Failures are typed mapping errors.

**Blocked by:** 21 (EDIFACT validation with ORDERS and INVOIC definitions), 26 (Document Structures live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (mapping engine: apply a Mapping Version to a Document)
- [ ] The Mapping schema (Zod) is declarative and versionable
- [ ] Each transform is covered by worked examples with independent expected values
- [ ] Line-item loops produce repeated segment groups
- [ ] A missing required source value yields a typed mapping error naming the target element
- [ ] Output for a reference invoice matches a hand-checked golden INVOIC
