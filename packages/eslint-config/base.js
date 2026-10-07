import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import perfectionist from 'eslint-plugin-perfectionist'
import turboPlugin from 'eslint-plugin-turbo'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      turbo: turboPlugin,
      '@stylistic': stylistic,
      perfectionist,
      unicorn,
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: 'export' },
        { blankLine: 'always', prev: 'export', next: '*' },
      ],
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            ['value-builtin', 'value-external'],
            ['type-builtin', 'type-external'],
            'value-internal',
            'type-internal',
            ['value-parent', 'value-sibling', 'value-index'],
            ['type-parent', 'type-sibling', 'type-index'],
            'value-side-effect',
            'value-side-effect-style',
            'unknown',
          ],
          internalPattern: ['^@edi-bridge/.+', '^@/.+', '^~/.+'],
          newlinesBetween: 1,
          order: 'asc',
          type: 'natural',
        },
      ],
      'perfectionist/sort-jsx-props': [
        'error',
        {
          customGroups: [
            { elementNamePattern: '^key$', groupName: 'key' },
            { elementNamePattern: '^id$', groupName: 'id' },
            { elementNamePattern: '^aria-', groupName: 'aria' },
            { elementNamePattern: '^data-', groupName: 'data' },
            { elementNamePattern: '^on[A-Z]', groupName: 'handler' },
            { elementNamePattern: '^className$', groupName: 'className' },
            { elementNamePattern: '^style$', groupName: 'style' },
          ],
          groups: ['key', 'id', 'unknown', 'aria', 'className', 'style', 'data', 'handler'],
          type: 'natural',
        },
      ],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    },
  },
  {
    // Plain JS files (eslint/prettier configs etc.) are not part of any tsconfig
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: [
      'dist/**',
      '.turbo/**',
      'coverage/**',
      'storybook-static/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
]
