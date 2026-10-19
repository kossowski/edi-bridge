import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  fixedExtension: false,
  deps: { alwaysBundle: [/^@edi-bridge\//], onlyBundle: ['jsonata'] },
})
