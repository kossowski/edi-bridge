import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/create-operator.ts'],
  fixedExtension: false,
  deps: { alwaysBundle: [/^@edi-bridge\//], onlyBundle: ['jsonata'] },
})
