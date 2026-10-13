# 77: Not-found pages answer 404

**What to build:** An unknown address shows "Page not found" and answers with HTTP status 404. Today the catch-all route shows the page but answers 200, for example for old `/runs/<id>` and `/order-lifecycle` links (tickets 60, 61, 67). The pages for an unknown Trading Partner, Mapping or other record by ID answer 404 as well.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] An unknown address answers 404 and shows "Page not found" inside the app frame
- [ ] `/runs/<id>` and `/order-lifecycle` answer 404, or redirect to the page that replaced them
- [ ] A Playwright test checks the status code of an unknown address
