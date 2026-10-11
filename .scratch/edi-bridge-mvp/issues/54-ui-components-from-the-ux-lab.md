# 54: UI components from the UX lab

**What to build:** The shadcn components that the UX lab added to `packages/ui` move to `main` in one small PR, so the screen tickets after it can use them: accordion, avatar, breadcrumb, button-group, collapsible, command, context-menu, field, hover-card, input-group, item, kbd, label, popover, scroll-area, sonner, spinner, switch and tabs. They come over from `feat/19-ux-lab` with `git checkout feat/19-ux-lab -- <paths>`, together with the `overlay` prop of `sheet.tsx` and the `--ai-attention` token in `globals.css`.

**Blocked by:** None

**Status:** done

- [x] The listed components, their dependencies (`packages/ui/package.json`, `sonner` in `apps/web`) and the lockfile changes are on the branch; nothing from `apps/web/components/lab/**` or `apps/web/app/(lab)/**` comes over
- [x] Clicking an `InputGroupAddon` focuses the input again (the lab's lint fixes removed this), built in a way that passes the lint rules
- [x] `Sheet` accepts the `overlay` prop; `globals.css` defines `--ai-attention` for dark and light mode
- [x] Pre-commit hooks and CI pass without disabling rules

## Comments

Resolved in #71.
