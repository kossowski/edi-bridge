import { builtinRules } from 'eslint/use-at-your-own-risk'

export default {
  meta: { name: 'eslint-core' },
  rules: {
    'no-dupe-args': builtinRules.get('no-dupe-args'),
    'no-octal': builtinRules.get('no-octal'),
  },
}
