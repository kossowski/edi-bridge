const config = {
  '{apps,packages/!(oxlint-config)}/**/*.{js,mjs,ts,tsx}': 'oxlint --fix',
  '*': 'oxfmt --no-error-on-unmatched-pattern',
}

export default config
