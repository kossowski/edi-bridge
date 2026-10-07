import { readdirSync } from 'node:fs'

/**
 * Scopes are the app and package folder names, plus `repo` for root-level changes.
 */
const workspaceScopes = ['apps', 'packages'].flatMap((dir) =>
  readdirSync(new URL(`./${dir}/`, import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
)

/**
 * @see https://commitlint.js.org/reference/configuration.html
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-co-author': ({ raw }) => [
          !/^co-authored-by:/im.test(raw ?? ''),
          'commit message must not contain a Co-Authored-By trailer',
        ],
      },
    },
  ],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', ['repo', ...workspaceScopes]],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
    'body-empty': [2, 'never'],
    'no-co-author': [2, 'always'],
  },
}

export default config
