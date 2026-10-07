# 39: CONTRL, Acknowledgements and Overdue

**What to build:** Received Interchanges are answered with a CONTRL automatically, including rejections for syntax errors. Incoming CONTRLs are matched to the sent Interchange by control reference, setting its Acknowledgement status (pending → accepted | rejected). A sent Interchange whose Acknowledgement doesn't arrive within the Trading Partner's time limit becomes Overdue.

**Blocked by:** 37 (Failure Stages, Retry and Reprocess)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline; time limit driven by Effect's test clock)
- [ ] Every received Interchange gets a CONTRL delivered back to the partner, rejecting broken ones
- [ ] An incoming CONTRL updates the matching sent Interchange to accepted or rejected
- [ ] Without a CONTRL within the partner's limit, the Interchange becomes overdue
- [ ] Acknowledgement status is separate from Run status
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
