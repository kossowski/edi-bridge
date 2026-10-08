# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`, path `skills/install-anti-slop/assets/anti-slop/`.

The copy in this directory is byte-identical to that path at that commit. It was installed on 2026-10-08 with the `install-anti-slop` skill.

## Installed paths

- Generic plugin: `packages/oxlint-config/anti-slop/index.ts`, registered in `packages/oxlint-config/base.json`.
- Effect plugin: `packages/oxlint-config/anti-slop/effect/index.ts`, registered in `packages/oxlint-config/base.json` ahead of the `effect` dependency, at the project's request.
- Vendored ESLint Stylistic rule: `vendor/eslint-stylistic/`, with its own `LICENSE` and `UPSTREAM.md`.

## Intentional deviations

- No source changes.
- `base.json` sets `categories.correctness` to `off`. ESLint stays the primary linter, and Oxlint runs only the anti-slop rules and `oxc/no-accumulating-spread`.
- Each workspace has a `.oxlintrc.json` that extends `./node_modules/@edi-bridge/oxlint-config/base.json`. Oxlint does not resolve package names in `extends`, so the path goes through `node_modules`. Its `lint` script runs `oxlint && eslint`.
