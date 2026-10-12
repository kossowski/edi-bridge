# 47: AI-drafted Mappings

**What to build:** Admins ask the AI (Vercel AI SDK) for a Mapping draft from a sample Document and a target Message Type. The model returns a flat list of proposed links via structured output, uses tools to look up segment definitions and to run its draft against the sample, and corrects validation errors before presenting. The client receives progress steps while the model works and the links once they pass the check. Links are marked as AI-proposed; the Admin rejects, edits or accepts individual links, or accepts the Draft as a whole, and a Draft with an open review can't be published. A daily token budget per Workspace applies; Viewers have no AI access.

**Blocked by:** 29 (Mappings live), 45 (Login, roles and invites)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes; the model provider is mocked at the system boundary)
- [ ] Structured output is validated against the Zod link schema and converted into a Draft
- [ ] The tool loop runs the draft against the sample and feeds errors back to the model
- [ ] Progress steps stream to the client; links are sent only after they pass the check
- [ ] Publishing is rejected while the Draft's AI review is open; accepting the Draft clears the AI-proposed marks
- [ ] Exceeding the daily Workspace budget is rejected with a clear message
- [ ] Viewers cannot call AI endpoints
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
- [ ] `acceptAiProposedPartsEndpoint` (`POST /mappings/:id/ai-draft/accept-parts`) clears marks by the shared rule `acceptedAiReview`, rejects keys the review does not mark with 409, and closes the review once no proposed part (link, Transform or Transform Link) is left (ticket 66)
