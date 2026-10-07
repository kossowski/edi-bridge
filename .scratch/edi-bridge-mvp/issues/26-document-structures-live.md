# 26: Document Structures live

**What to build:** Admins create Document Structures via the real api from a sample Document (JSON or CSV) or a JSON Schema and adjust them. Every source format is parsed into one common tree. CSV dialects (delimiter, header row, encoding including Windows-1252) are honoured.

**Blocked by:** 24 (Trading Partners live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Structure inference from JSON and CSV samples, including nesting and repetitions
- [ ] Creation from a JSON Schema
- [ ] A Windows-1252 CSV with umlauts is read correctly when that encoding is configured
- [ ] JSON and CSV parse into the same common tree shape
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
