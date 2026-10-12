# 56: App frame with account menu and two-row header

**What to build:** The new frame of the dashboard replaces the current sidebar and header. The sidebar has the groups from ticket 55 and the account menu at the bottom (avatar, name, role, Workspace, language, theme, Settings, Operator area for the Operator, sign out). The sticky header has two rows: the breadcrumb, a large search field that opens a ⌘K command palette (orders, partners, documents, pages), and a slot for the notification bell (ticket 58); below it a row for the page's tabs. Pages no longer show a visible headline or description; each page has an sr-only `h1` and the breadcrumb names it. Reference: `/lab` shell on `feat/19-ux-lab` (`lab-sidebar`, `lab-nav-user`, `lab-header`, `lab-tabs`, `lab-search`).

**Blocked by:** 54 (UI components from the UX lab), 55 (On-screen labels and task-first navigation)

**Status:** done

- [x] The sidebar shows the groups and labels from ticket 55; "Advanced" is collapsible; nav items have a tooltip with a short hint when the sidebar is collapsed; links to screens not rebuilt yet point at their current routes
- [x] The account menu at the bottom of the sidebar holds language and theme switches and works collapsed and on mobile; the header has no separate language, theme or user buttons any more
- [x] The breadcrumb names every page from its route, including entity names on detail pages
- [x] Pages can render tabs into the header's second row; the row is hidden when a page has no tabs; the tab bar has a background
- [x] The header search field is large; ⌘K / Ctrl+K opens the command palette, which searches orders, partners, documents and pages and opens the chosen one; the palette input keeps its default size
- [x] Every page has an sr-only `h1` and no visible headline or description; the shared page wrapper offers a meta line and actions row
- [x] The frame is keyboard-navigable and usable from desktop down to tablet width; the Viewer badge still shows
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode
- [x] Existing stories and tests of the current shell (`app-header`, `app-sidebar` and the switchers) stay green or are updated in the same PR

## Comments

Resolved in #73, #74, #77, #78.
