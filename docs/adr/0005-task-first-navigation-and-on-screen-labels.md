# Task-first navigation and on-screen labels

The people who use EDI Bridge every day are business users, not EDI specialists. They think in documents and orders, not in Runs, Interchanges, or Order Lifecycles. The team tried the screens from their side in the UX lab, a clickable prototype of the screens built before the real ones. We follow its result: the sidebar is grouped by task, and the screens use plain labels while the domain terms stay everywhere else. [`GLOSSARY.md`](../../GLOSSARY.md) states this rule and lists the on-screen label for each term, in English and German.

## Sidebar

The sidebar has three groups:

- **Daily work**: **Home**, **Documents**, **Orders**.
- **Setup**: **Trading partners**, **Mappings**, **Code translations**, **Your data formats**.
- **Advanced**, collapsible: **All connections**, **All document routes**, **Transmissions**.

**Help & glossary** and the account menu are at the bottom of the sidebar.

## Routes

The screens get these new routes:

| Route                | Screen            |
| -------------------- | ----------------- |
| `/`                  | Home              |
| `/tasks`             | Tasks             |
| `/first-steps`       | First steps       |
| `/documents`         | Documents         |
| `/orders`            | Orders            |
| `/code-translations` | Code translations |
| `/data-formats`      | Your data formats |
| `/help`              | Help & glossary   |

**Tasks** and **First steps** are not in the sidebar. The bell in the header and the **Home** screen open `/tasks`. A Workspace without any setup sees **First steps** at `/first-steps` instead of **Home**.

**Transmissions** in the sidebar opens the Transmissions view of **Documents**, `/documents?view=transmissions`. It has no route of its own.

The old routes `/runs`, `/interchanges`, `/order-lifecycle`, `/lookup-tables`, and `/document-structures` are removed without redirects.

The global Channels and Flows screens keep their pages and their routes, `/channels` and `/flows`. Only their labels change, to **All connections** and **All document routes**.

## Considered options

We rejected these alternatives:

- Rename the domain terms everywhere to the plain words. The domain terms follow EDIFACT and the existing code, contracts, and API. The change would touch all of them and give users nothing.
- Keep the domain terms on screen. Business users do not know Run, Interchange, or Lookup Table.

We chose plain labels on screen only.

## Consequences

A route name and its glossary term can differ. For example, `/documents` shows Runs, and `/code-translations` shows Lookup Tables.
