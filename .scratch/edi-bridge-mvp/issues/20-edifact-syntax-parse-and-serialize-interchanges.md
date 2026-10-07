# 20: EDIFACT syntax: parse and serialize Interchanges

**What to build:** The standalone edifact package parses EDIFACT Interchanges (UNA service string advice, delimiters, release character, UNB/UNZ and UNH/UNT envelopes, segments, composites, elements) into a structured form, and serializes that form back byte for byte. Parse errors carry exact positions (segment, element, component).

**Blocked by:** 03 (Dockerfiles, full-stack Compose profile and CI)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (edifact: parse and serialize)
- [ ] Expected values come from hand-checked golden files based on EANCOM documentation examples, never from the package's own output
- [ ] Interchanges with and without UNA, with release characters and with multiple Messages are handled
- [ ] Parse errors are typed and report segment, element and component positions
- [ ] Serializing a parsed Interchange reproduces it byte for byte
- [ ] Golden files include deliberately broken Interchanges
- [ ] The package has no dependency on the rest of the platform
