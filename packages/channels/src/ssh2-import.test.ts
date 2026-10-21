import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// The built apps load ssh2 through Node ESM, which finds only some named exports of the
// CommonJS module; Vitest's interop finds them all, so the tests alone miss a wrong import.
const nodeEsmExports = () =>
  z
    .array(z.string())
    .parse(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            "console.log(JSON.stringify(Object.keys(await import('ssh2'))))",
          ],
          { cwd: import.meta.dirname, encoding: 'utf8' },
        ),
      ),
    )

const namedValueImports = (source: string) =>
  [...source.matchAll(/import\s*(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*'ssh2'/g)].flatMap(
    ([, names = '']) =>
      names
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '' && !name.startsWith('type '))
        .map((name) => name.split(/\s+as\s+/)[0] ?? name),
  )

describe('ssh2 imports', () => {
  it('name only exports that Node ESM finds in the CommonJS module', () => {
    const exported = nodeEsmExports()

    const missing = readdirSync(import.meta.dirname)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        namedValueImports(readFileSync(`${import.meta.dirname}/${file}`, 'utf8'))
          .filter((name) => !exported.includes(name))
          .map((name) => `${file}: ${name}`),
      )

    expect(missing).toEqual([])
  })
})
