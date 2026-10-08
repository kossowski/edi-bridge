# 01: Web app and ui package skeleton

**What to build:** A Next.js web app that renders a single empty page using one shadcn component from a separate ui package. The ui package follows shadcn's monorepo layout, initialised with Base UI primitives, the Nova style, Hugeicons, the Geist font and the neutral base colour. No domain logic, no real UI beyond the empty page.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The web app starts with the monorepo's dev command and shows an empty page that renders a component imported from the ui package
- [x] The ui package is configured with Base UI, Nova, Hugeicons, Geist and the neutral base colour
- [x] Tailwind picks up class names used inside the ui package
- [x] Both packages use the shared ESLint and TypeScript configs and are wired into the Turborepo tasks dev, build, lint and check-types
- [x] Lint, typecheck and build pass from the repository root
