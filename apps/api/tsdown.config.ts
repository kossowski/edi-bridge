import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/create-operator.ts', 'src/create-demo-workspaces.ts'],
  fixedExtension: false,
  deps: { alwaysBundle: [/^@edi-bridge\//], onlyBundle: ['jsonata'] },
})
