# 72: AI field names and suggested code values

**What to build:** Two more uses of the AI (Vercel AI SDK, as in ticket 47): when a data format is read from an example file, the AI names each field in plain words with a short reason and flags names it is unsure about; when a new code translation list is started, the AI suggests the first values for its kind and the Workspace's partners. Both stay within the daily Workspace AI budget and are unavailable to Viewers.

**Blocked by:** 47 (AI-drafted Mappings), 25 (Lookup Tables live), 26 (Document Structures live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes; the model provider is mocked at the system boundary)
- [ ] Field names come back via structured output validated against the Zod contract, each with a reason and an unsure flag; the detected structure itself still comes from ticket 26 without AI
- [ ] Suggested code values are validated against the contract and never saved without the user accepting them
- [ ] Both count against the daily Workspace budget; exceeding it is rejected with a clear message
- [ ] Viewers cannot call these endpoints
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
- [ ] Code meanings, suggested or stored, are returned per language, so German pages show German meanings (ticket 67)
