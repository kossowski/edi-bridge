# 10: Channels, Flows and Manual Submission prototype

**What to build:** Admins configure Channels (inbound SFTP with polling interval, inbound webhook with secret token, outbound SFTP, outbound HTTP) with secrets masked after saving, and define Flows (Message Type, Trading Partner, inbound Channel, pinned Mapping Version, destination Channel). Operations users can make a Manual Submission: upload a Document as if it arrived on a chosen inbound Channel.

**Blocked by:** 09 (Trading Partners prototype)

**Status:** done

- [x] Forms for all four Channel types; secrets are never displayed in full after saving
- [x] Webhook Channels show their URL and allow regenerating the token
- [x] Flow form with pinned Mapping Version and an explicit 'move to newer version' action
- [x] Manual Submission dialog: pick an inbound Channel, upload a Document, see the resulting (mocked) Run
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #11, #12, #13, #14
