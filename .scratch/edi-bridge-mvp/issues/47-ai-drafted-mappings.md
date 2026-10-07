# 47: AI-drafted Mappings

**What to build:** Admins ask the AI (Vercel AI SDK) for a Mapping draft from a sample Document and a target Message Type. The model returns a flat list of proposed links via structured output, uses tools to look up segment definitions and to run its draft against the sample, and corrects validation errors before presenting. Links stream onto the canvas, are marked as AI-proposed and accepted or rejected individually. A daily token budget per Workspace applies; Viewers have no AI access.

**Blocked by:** 29 (Mappings live), 45 (Login, roles and invites)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes; the model provider is mocked at the system boundary)
- [ ] Structured output is validated against the Zod link schema and converted into a Draft
- [ ] The tool loop runs the draft against the sample and feeds errors back to the model
- [ ] Proposed links stream to the client
- [ ] Exceeding the daily Workspace budget is rejected with a clear message
- [ ] Viewers cannot call AI endpoints
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
