import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/create-operator.ts'],
  fixedExtension: false,
  // The bundled @edi-bridge/channels code imports ssh2 at runtime, so ssh2 stays a direct dependency.
  deps: { alwaysBundle: [/^@edi-bridge\//], onlyBundle: ['jsonata'] },
})
