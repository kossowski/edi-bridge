# EDI Bridge MVP

Status: ready-for-agent

> Synthesised from the design interview of 2026-10-07. Vocabulary follows `GLOSSARY.md`; architectural decisions are recorded in `docs/adr/` (ADR-0001 to ADR-0004). Approved 2026-10-07. Work happens in issues/; this spec is the reference, not a work item.

## Problem Statement

A supplier in the retail supply chain must exchange business documents with its Trading Partners (retailers) in EDIFACT (EANCOM D.96A), while its own ERP only speaks JSON or CSV. Without an integration layer, every partner means hand-written converters, nobody can see which Interchange was sent, received, rejected or never acknowledged, and when something breaks (a partner sends broken EDIFACT, a Mapping can't handle a missing GTIN, the partner's SFTP is down), operations staff have no way to tell whose problem it is, fix it, and push the Document through again without losing the audit trail.

Existing commercial tools (e.g. Lobster) solve this, but they are closed and heavyweight. There is no open-source, modern TypeScript integration platform that covers the full loop: Channels, Mappings built without code, an end-to-end Order Lifecycle view, and operations tooling for failures.

## Solution

EDI Bridge is an open-source integration platform that receives Documents on Channels (SFTP, webhook, Manual Submission), routes them through Flows, converts them with versioned Mappings between JSON/CSV and EDIFACT in both directions, validates outgoing EDIFACT, delivers it on outbound Channels (SFTP, HTTP), and tracks Acknowledgements.

- **Integration engineers** onboard Trading Partners (identity, Test Mode, onboarding checklist), build Mappings on a drag-and-drop canvas (or let the AI draft one for review link by link), maintain Lookup Tables, and publish immutable Mapping Versions.
- **Operations staff** watch live traffic, inspect each Run (step timeline, raw Interchange with the error position highlighted, parsed tree), Retry delivery failures, Reprocess mapping failures with a chosen Mapping Version, and see Duplicates and Overdue Acknowledgements.
- **Business users** search by Business Reference and see the Order Lifecycle (ORDERS → DESADV → INVOIC with Acknowledgements).

The supported loop: a retailer sends ORDERS over SFTP → EDI Bridge maps it to JSON and delivers it to the ERP → the ERP sends dispatch and invoice data (JSON or CSV) → EDI Bridge produces DESADV and INVOIC and delivers them to the retailer → the retailer returns CONTRL.

The platform is fully usable on its own. A separately maintained Partner Simulator (its own repository, built after the MVP) produces continuous, realistic traffic for the public live demo through the same Channels as any real partner.

## User Stories

### Access and Workspaces

1. As the Operator, I want to create Workspaces, so that each company's Trading Partners, Mappings and traffic are isolated.
2. As the Operator, I want to create an invite for a user to a Workspace with a role (Admin or Viewer) and copy its link to send it myself, so that nobody can sign up on their own.
3. As an invited user, I want to set my password through the invite link, so that I can log in with email and password.
4. As the Operator, I want new Workspaces to optionally start from the seed data, so that a fresh Workspace is immediately explorable.
5. As a visitor of the live demo, I want a single "View live demo" button that logs me into the Showcase Workspace as a Viewer, so that I can explore the product in seconds without an account.
6. As a Viewer, I want to see everything in my Workspace, so that I understand what is happening.
7. As a Viewer, I want every changing action to be unavailable to me, so that the Showcase Workspace stays pristine.
8. As the Operator, I want to share a showcase-admin login that grants Admin in the Sandbox Workspace, so that people I demo to can try every feature.
9. As the Operator, I want to reset the Sandbox Workspace to its seed on demand (from the Operator area or a CLI command), so that it is clean before a meeting.
10. As an Admin, I want full control within my Workspace and none outside it, so that tenants can't affect each other.
11. As any user, I want the UI in English or German, so that I can work in my language.
12. As any user, I want dark and light mode, so that the dashboard is comfortable in any setting.

### Trading Partners and onboarding

13. As an Admin, I want to record my own company's identity (GLN) in the Workspace, so that every Interchange carries the correct sender.
14. As an Admin, I want to create a Trading Partner with its GLN and syntax settings (character set level), so that Interchanges to them have correct envelopes.
15. As an Admin, I want a new Trading Partner to start in Test Mode, so that onboarding traffic is flagged as test.
16. As an Admin, I want an onboarding checklist per Trading Partner (identity set → test Interchange sent → CONTRL received → production on), so that I know exactly where onboarding stands.
17. As an Admin, I want to switch a Trading Partner from Test Mode to production explicitly, so that production traffic only starts on purpose.
18. As an Admin, I want to set an Acknowledgement time limit per Trading Partner, so that missing CONTRLs are detected.
19. As an Admin, I want to see per Trading Partner its Channels, Flows and recent Runs, so that I have one place for everything about that partner.

### Channels

20. As an Admin, I want to configure an inbound SFTP Channel with a polling interval (default one minute), so that Documents dropped by partners are picked up automatically.
21. As an Admin, I want to configure an inbound webhook Channel with its own secret token, so that systems can POST Documents to EDI Bridge securely.
22. As an Admin, I want inbound webhooks to be rate limited per Channel, so that a misbehaving sender can't overwhelm the platform.
23. As an Admin, I want to configure an outbound SFTP Channel, so that EDIFACT is uploaded to a partner's inbox.
24. As an Admin, I want to configure an outbound HTTP Channel, so that Documents can be POSTed to the ERP.
25. As an Admin, I want Channel secrets (passwords, keys, tokens) stored encrypted and never shown again in full, so that credentials are safe.
26. As an operations user, I want to make a Manual Submission of a Document as if it had arrived on a chosen inbound Channel, so that I can process files a partner sent by email.
27. As a contributor, I want a CLI command that submits a fixture Document to a Channel, so that I can drive the real pipeline locally and in end-to-end tests.
28. As an operations user, I want Manual Submissions marked as manual on their Runs, so that the audit trail shows how a Document entered.

### Document Structures and Mappings

29. As an Admin, I want to create a Document Structure from a sample Document, so that the mapper knows the shape of my ERP's JSON or CSV.
30. As an Admin, I want to create a Document Structure from a JSON Schema the ERP provides, so that I don't depend on a representative sample.
31. As an Admin, I want to adjust an inferred Document Structure, so that optional or repeating fields are represented correctly.
32. As an Admin, I want to configure CSV specifics (delimiter, header row, character encoding including Windows-1252), so that German umlauts and real ERP exports come through intact.
33. As an Admin, I want to map a Document Structure to an EDIFACT Message Type (outbound) and an EDIFACT Message Type to a Document Structure (inbound) on the same canvas, so that both directions work the same way.
34. As an Admin, I want to draw links from source fields to target elements on a canvas, so that I can build Mappings without code.
35. As an Admin, I want transform nodes between source and target (constant, concatenate, split, substring, date format, number format, Lookup Table, conditional, loop over line items), so that common conversions need no code.
36. As an Admin, I want a JSONata expression node as an escape hatch, so that edge cases are still possible without arbitrary code.
37. As an Admin, I want a live preview of the target Document for a chosen sample, so that I see the effect of every change immediately.
38. As an Admin, I want to see the meaning of EDIFACT segments and elements (e.g. what `DTM+137` is) on the canvas, so that I don't need the standard open in another window.
39. As an Admin, I want to edit a Draft without affecting live traffic, so that work in progress is safe.
40. As an Admin, I want to publish a Draft as a new immutable Mapping Version, so that traffic only uses reviewed Mappings.
41. As an Admin, I want each Flow pinned to a specific Mapping Version and to move it to a newer version explicitly, so that changes never reach production by surprise.
42. As an Admin, I want to compare two Mapping Versions, including their outputs for the same Document, so that I understand what a change does.
43. As an Admin, I want to maintain Lookup Tables per Workspace or per Trading Partner, editable in the UI and importable from CSV, so that code translations (e.g. `ST` → `PCE`) are reusable.
44. As a user on a small screen, I want a clear notice that the mapper requires a desktop, so that I'm not confronted with a broken canvas.

### AI-drafted Mappings

45. As an Admin, I want the AI to propose a Mapping from a sample Document and a target Message Type, so that I start from a draft rather than a blank canvas.
46. As an Admin, I want AI-proposed links to appear on the canvas as they are produced, so that I can follow what the AI is doing.
47. As an Admin, I want each AI-proposed link marked as such and individually accepted or rejected, so that nothing the AI made goes live unreviewed.
48. As an Admin, I want the AI to check its own draft against the sample and fix validation errors before presenting it, so that drafts are mostly correct.
49. As the Operator, I want a daily AI token budget per Workspace, so that the shared showcase-admin login can't exhaust the API budget.
50. As a Viewer, I want AI features unavailable, so that read-only access has no cost.

### Flows and processing

51. As an Admin, I want to define a Flow (Documents of one Message Type, from one Trading Partner, on one Channel, through one Mapping Version, to one destination Channel), so that routing is explicit.
52. As an operations user, I want every incoming Interchange split so that each Message gets its own Run, so that one bad Message doesn't block valid ones.
53. As an operations user, I want a re-sent Interchange (same sender and control reference) recorded as a Duplicate and not processed, so that the ERP never receives an order twice.
54. As an operations user, I want every generated EDIFACT Message validated against its message definition (required segments, repetitions, lengths, code lists) before delivery, so that invalid EDIFACT never reaches a partner.
55. As an operations user, I want each outbound Message sent in its own Interchange, so that Acknowledgements map one to one.
56. As an operations user, I want received Interchanges answered with a CONTRL automatically, including rejections for broken syntax, so that partners learn about problems without manual work.
57. As an operations user, I want incoming CONTRLs matched to the Interchange they acknowledge, so that each sent Interchange shows accepted or rejected.
58. As an operations user, I want a sent Interchange marked Overdue when its Acknowledgement doesn't arrive within the partner's time limit, so that silent losses are noticed.

### Runs and failure handling

59. As an operations user, I want a filterable table of Runs (status, Failure Stage, Trading Partner, Message Type, Flow, time range, manual or not), so that I find what I'm looking for quickly.
60. As an operations user, I want each Run to show its status (received, processing, delivered, failed, duplicate), so that the outcome is obvious.
61. As an operations user, I want a failed Run to state its Failure Stage (parse, validation, mapping or delivery), so that I know whose problem it is and what can fix it.
62. As an operations user, I want a Run detail page with a step timeline, so that I see where time went and where it failed.
63. As an operations user, I want to see the raw Interchange with the exact error position (segment, element, component) highlighted, so that I can explain the problem to the partner precisely.
64. As an operations user, I want a parsed tree view of a Message, so that I can read EDIFACT without decoding it by hand.
65. As an operations user, I want to see which Mapping Version a Run used, so that I can relate failures to Mapping changes.
66. As an operations user, I want to Retry a Run that failed at delivery, so that transient outages are resolved without re-mapping.
67. As an operations user, I want to Reprocess a Run that failed at mapping with a chosen Mapping Version, so that a fixed Mapping can be applied to the original Document.
68. As an operations user, I want a Reprocessed Run linked to the Run it replaces, so that the audit trail is complete.
69. As an operations user, I want the original Document never to be editable, so that the audit trail can be trusted.
70. As an operations user, I want Runs that failed at parse or validation of an inbound Interchange marked as awaiting a resend from the partner, so that nobody tries to fix the partner's error on our side.
71. As an operations user, I want to see an Interchange together with all the Runs it produced, so that multi-Message Interchanges are understandable.

### Dashboard and Order Lifecycle

72. As an operations user, I want an Overview with live throughput, error rate, health per Trading Partner and Overdue Acknowledgements, so that I see the state of the platform at a glance.
73. As an operations user, I want the dashboard to update live without reloading, so that I see traffic as it happens.
74. As a business user, I want to search by Business Reference (e.g. an order number), so that I can answer "did the retailer get our invoice for order 4711?".
75. As a business user, I want the Order Lifecycle shown as a timeline (ORDERS → DESADV → INVOIC with their Acknowledgements), so that I see the status of a business case end to end.
76. As any user, I want useful empty, loading and error states on every screen, so that the product feels solid even without data.
77. As any user, I want large tables (tens of thousands of Runs) to stay responsive, so that the dashboard works on real volumes.
78. As a keyboard user, I want to operate tables and the mapper without a mouse, so that the product is accessible.

### Retention and operations of the platform

79. As the Operator, I want raw Documents kept for a retention period per Workspace, so that storage doesn't grow without bound while Reprocess remains possible.
80. As the Operator, I want unexpected errors (defects) reported to error monitoring with Workspace, Run and Trading Partner attached, so that I can diagnose bugs.
81. As the Operator, I want expected domain failures (e.g. a partner's broken EDIFACT) kept out of error monitoring, so that the free quota isn't burned by normal traffic.
82. As the Operator, I want a single trace to follow a Run from receipt to delivery, so that I can see where time is spent.

### Contributors and the `edifact` package

83. As a contributor, I want a library of realistic fixture Documents (valid and deliberately broken) in the repository, so that I can develop and test without the Partner Simulator.
84. As a contributor, I want the dashboard runnable against mocked API responses, so that I can work on UI without the backend.
85. As a developer outside this project, I want to use the `edifact` package on its own to parse, validate and serialize EANCOM Interchanges, so that I benefit without adopting the platform.
86. As a user of the `edifact` package, I want parse and validation errors to carry exact positions, so that I can report problems precisely.
87. As a user of the `edifact` package, I want byte-for-byte reproducible output from the same input, so that partners receive consistent files.
88. As a visitor of the GitHub repository, I want a published Storybook, so that I can browse the component library.

## Implementation Decisions

### Shape of the system

- A pnpm-workspaces + Turborepo monorepo. The barebone (lint, format, git hooks) is provided by the maintainer; all further foundation work starts after it is handed over.
- Three deployable apps, each its own container: **web** (Next.js dashboard), **api** (Fastify) and **worker** (BullMQ processors running Effect programs: Channel polling, Runs, delivery, Acknowledgement and Overdue checks).
- Shared packages (names indicative): **edifact** (syntax and message definitions), **mapping** (Mapping schema and engine), **contracts** (Zod schemas for API and domain shapes), **db** (Drizzle schema and access), **mocks** (MSW request handlers and dummy-data factories built from `contracts`), **ui** (shadcn/ui components).
- The **ui** package follows shadcn's monorepo layout and holds only generic building blocks (shadcn primitives, theme tokens, small domain-free compositions). EDI-specific components and screens (Run timeline, mapper canvas, pages) stay in **web**.
- There is one Storybook, living in **web**. It covers web's components and screens (against the MSW handlers) and also shows the stories of the **ui** package.
- MSW is a package, not an app, and the **api** never knows about it. Its consumers are **web** (the browser worker, started by a mock flag; the generated worker script lives in web's public folder), Storybook and Playwright.
- Postgres (via Drizzle) is the system of record, including raw Documents (behind a storage interface so object storage stays possible). Redis backs BullMQ and the pub/sub for live updates.

### Framework decisions (see ADRs)

- **ADR-0001:** Fastify only at the HTTP edge (routing, Zod request validation, the better-auth handler); Effect for everything behind it. Effect's own HTTP API is not used (unstable in Effect 4.0).
- **ADR-0002:** our own `edifact` package: tokenizer, parser, serializer and validator, with hand-typed definitions only for ORDERS, DESADV, INVOIC and CONTRL (EANCOM D.96A). Correctness was cross-checked once against node-edifact and EDIFlow, which are not dependencies.
- **ADR-0003:** Vercel AI SDK for AI-drafted Mappings; Effect's AI module is not used.
- **ADR-0004:** Zod is the only schema system, including inside the Effect core. A small helper turns a failed Zod parse into a tagged Effect error. Effect modules that require Effect Schema are not used.

### Error model

- Expected failures are typed Effect errors (parse, validation, mapping, delivery) and become a Run's Failure Stage; they are domain outcomes shown in the dashboard and **never** reported to Sentry.
- Only defects (bugs, crashes) go to Sentry, tagged with Workspace, Run and Trading Partner. Traces are sampled (around 10–20% of Runs) to stay within the free plan's shared quotas across the three apps.

### Domain model decisions

- Every table is scoped to a Workspace from the first migration onward.
- Run status: `received → processing → delivered | failed | duplicate`. A failed Run records its Failure Stage. Remedies by Failure Stage:
  - delivery → Retry
  - mapping → Reprocess with a chosen Mapping Version
  - parse or validation of an inbound Interchange → awaiting a resend from the partner, with a CONTRL rejection sent automatically
- Acknowledgement status on sent Interchanges, separate from Run status: `pending → accepted | rejected | overdue`.
- Inbound Interchanges are split into one Run per Message. A CONTRL refers to the whole Interchange.
- Duplicate detection key: sender identity plus Interchange control reference.
- Outbound: one Message per Interchange.
- Linking: the Business Reference (order number from BGM or RFF+ON) links Messages into an Order Lifecycle. The Interchange control reference links a CONTRL to the sent Interchange.
- Mapping: a declarative, versioned document validated by a Zod schema; transform nodes from the fixed catalogue; JSONata as the only expression language. One Draft per Mapping; publishing creates an immutable Mapping Version; Flows pin a Mapping Version; Runs record the version they used.
- The AI produces a flat list of proposed links (not the nested Mapping) via structured output. The links are converted into a Draft and marked as AI-proposed until accepted or rejected. The model has tools to look up segment definitions and to run its draft against the sample.
- Document Structures describe JSON and CSV Documents on either side of a Mapping, inferred from a sample or created from a JSON Schema. Every source format is parsed into one common tree, so XML can be added later without redesign.
- Trading Partner holds GLN, syntax settings, Test Mode, Acknowledgement time limit and onboarding state. The Workspace holds the company's own GLN.
- Lookup Tables belong to a Workspace or to a single Trading Partner.
- Seed data uses fictional company names and GLNs from GS1's restricted-circulation prefixes (020–029) with valid check digits.

### Channels

- Inbound: SFTP (polled, interval per Channel, default one minute), webhook (secret token per Channel plus rate limiting), Manual Submission (UI) and a CLI command. Both go through the same pipeline as Channel traffic.
- Outbound: SFTP upload and HTTP POST.
- Channel secrets are encrypted in Postgres.
- Channel adapters are Effect services with operation-specific interfaces (not a generic client), injected so they can be replaced at system boundaries.

### Access

- better-auth with email and password only, running in the Fastify API. No sign-up page; the Operator creates Workspaces and invites users.
- No email is sent in the MVP: the Operator copies the invite link and passes it on personally. Sending sits behind an interface, so SMTP delivery can be added later.
- Roles: Operator (platform-wide), Admin and Viewer (per Workspace).
- "View live demo" logs into a fixed Viewer account of the Showcase Workspace without a form. The shared showcase-admin account is Admin in the Sandbox Workspace.
- The Sandbox reset is manual only (Operator action and CLI command); there is no schedule.
- The AI token budget is enforced per Workspace per day.

### Frontend

- Next.js; shadcn/ui using **Base UI** primitives, the **Nova** style, **Hugeicons**, the **Geist** font and the **neutral** base colour; Tailwind CSS; next-intl (English as default, German).
- Server data lives in TanStack Query; Zustand holds only UI state (filters, canvas state).
- Data fetching happens in the browser by default, through one shared fetch layer with **one typed function per endpoint**. Server-side prefetching (prefetch plus hydration) and Server Actions stay possible later, using the same functions.
- Live updates use Server-Sent Events from the API, fed by Redis pub/sub from the workers. Events update or invalidate TanStack Query caches.
- The mapper canvas uses React Flow (xyflow); transforms are nodes between the source and target trees. The mapper is desktop-only; the rest of the dashboard works down to tablet width.
- Accessibility target: WCAG 2.2 AA.
- Screens:
  1. Overview
  2. Runs (table and Run detail)
  3. Order Lifecycle
  4. Trading Partners
  5. Mappings (canvas, versions, comparison, AI draft)
  6. Lookup Tables
  7. Settings and the Operator area

### Prototype-first UI

- Zod contract schemas come first; dummy data is generated from them.
- MSW (browser only) serves dummy data at the real API URLs, including SSE streams.
- MSW handlers are never deleted. They stay in the **mocks** package permanently, typed by the contracts so they can't silently drift, because Storybook, Playwright and UX iteration without a backend depend on them. When the backend serves an area, web switches from mock mode to the real API for it; since MSW intercepts the real URLs, UI code does not change.
- Server-side MSW (`msw/node`) is introduced only if a page starts fetching on the server.
- Dummy data covers empty, loading, error and large-volume states.

### Local development

- A Docker Compose file starts the infrastructure only: Postgres, Redis and an SFTP server (the same image the integration tests use).
- The three apps run natively through Turborepo (`pnpm dev`) for fast reloads and simple debugging.
- Each app has its own Dockerfile. A separate Compose profile runs the full stack (Playwright in CI, local checks against production builds); Dokploy uses the same Dockerfiles.
- Tests use Testcontainers and never depend on the local Compose services.

### Delivery

- GitHub Actions on pull requests: lint, typecheck, unit and integration tests, Storybook stories run as tests (including accessibility checks), Playwright. Turborepo caching limits runs to affected packages.
- `main` is protected: only pull requests with green required checks can be merged.
- The Dokploy GitHub app deploys on every push to `main` and builds the images on the VPS. If builds start disturbing the running demo, switch to images built in CI and pushed to GHCR.
- Storybook is published to GitHub Pages from `main`.
- The `edifact` package is versioned and published with Changesets. The npm org `edi-bridge` should be reserved early.

### Order of work

A sequence; the maintainer decides what runs in parallel:

1. Turborepo barebone (done by the maintainer)
2. **Walking skeleton**, with no domain logic and no UI beyond an empty page:
   - web: Next.js with shadcn initialised (Base UI, Nova, Hugeicons, Geist, neutral)
   - api: Fastify with a health route
   - worker: a process that starts, connects to Redis and reports health
   - Turborepo tasks (`dev`, `build`, `lint`, `check-types`, `test`) using the shared ESLint and TypeScript configs
   - a Dockerfile per app, the infrastructure Compose file, CI running against the skeleton
   - deployed once to Dokploy, so the deploy path is proven before there is logic to blame
3. Remaining foundation: contract schemas and the `mocks` package
4. UI prototype on MSW, covering all screens
5. `edifact` package
6. Mapping engine and Mapping Versions, with Workspace scoping in the data model
7. Worker pipeline: Runs, Failure Stages, Retry and Reprocess, Duplicates, Acknowledgements, Overdue
8. Channels, Manual Submission and the CLI command
9. Switch areas from mock mode to the real API as their backend lands (the MSW handlers stay)
10. Login UI, roles, Operator area, Showcase and Sandbox seed and the reset
11. AI-drafted Mappings
12. Live-demo deployment, then the Partner Simulator in its own repository

## Testing Decisions

- **What makes a good test:** it verifies behaviour through a public interface and survives refactors. Expected values come from an independent source of truth: hand-checked golden files based on EANCOM documentation examples, worked examples and literals. Never output produced by our own code. Mock only at system boundaries.
- **TDD:** red → green in vertical slices for everything except the UI prototype. The prototype phase is explicitly not test-first; a screen gets tests once it is accepted.
- **Seams** (confirmed in the interview; no test is written at any other seam without agreement):
  1. **`edifact` package:** parse, validate and serialize, against golden files of valid and deliberately broken Interchanges, including exact error positions and byte-exact output.
  2. **Mapping engine:** apply a Mapping Version to a Document, giving an output Document or a typed error.
  3. **Worker pipeline:** a Document arriving on a Channel, giving the Run outcome plus the delivered Document. Run against real Postgres, Redis and SFTP via Testcontainers. Time-based behaviour (polling, Overdue) is driven by Effect's test clock.
  4. **API:** HTTP routes via Fastify's request injection.
  5. **UI:** accepted screens via Storybook interaction and accessibility tests and Playwright, both against the same MSW handlers. Playwright later also runs against the full Docker Compose stack in CI.
- **Tools:** Vitest (including Storybook stories as tests), Testcontainers, Playwright.
- **Prior art:** none yet; the repository is empty. The tests written at these seams become the reference for later work.

## Out of Scope

- Transport protocols other than SFTP and HTTP (e.g. AS2, VANs)
- E-invoicing formats (XRechnung, ZUGFeRD)
- Self sign-up, social login and two-factor authentication
- Sending emails (invites are shared as copied links)
- Editing received Documents before Reprocess
- XML and fixed-width source formats in the MVP (XML follows right after)
- APERAK, ORDRSP and other Message Types in the MVP (APERAK is the second milestone)
- Bundling several outbound Messages into one Interchange
- HMAC-signed webhooks
- Mobile support for the mapper canvas
- Scheduled resets of the Sandbox Workspace
- Pull-request preview deployments
- The Partner Simulator itself (its own repository, after the MVP)

## Further Notes

- **Post-MVP order:** XML source format → APERAK (business rejections, the strongest Reprocess story) → outbound bundling per Trading Partner → HMAC webhook signatures.
- **Partner Simulator:**
  - It must use only public contracts: the published `edifact` package, the webhook schemas and the SFTP folder conventions. This keeps it from drifting from EDI Bridge.
  - Version 1 can be small: scheduled ORDERS from templates over SFTP, and an ERP webhook that answers with dispatch and invoice data after a delay. Some faults are injected on purpose.
  - The README should mention that the live demo's traffic comes from an external simulator.
- **Sentry free plan:** one user, 5,000 errors and 5M spans per month, shared by all three apps. Keeping domain failures out of Sentry is required, not optional.
