/**
 * @see https://github.com/lint-staged/lint-staged#configuration
 * @type {import('lint-staged').Configuration}
 */
const config = {
  '{apps,packages/!(oxlint-config)}/**/*.{js,mjs,ts,tsx}': 'oxlint --fix',
  '*': 'oxfmt --no-error-on-unmatched-pattern',
}

export default config
