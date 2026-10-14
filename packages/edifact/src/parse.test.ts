import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parse } from './index'

const validDirectory = new URL('../golden/valid/', import.meta.url)

const validInterchanges = readdirSync(validDirectory)
  .filter((file) => file.endsWith('.edi'))
  .map((file) => file.slice(0, -'.edi'.length))

const readGolden = (name: string, extension: string) =>
  readFileSync(new URL(`${name}.${extension}`, validDirectory), 'latin1')

describe('parse', () => {
  it.each(validInterchanges)('parses the valid Interchange %s', (name) => {
    expect(parse(readGolden(name, 'edi'))).toEqual(JSON.parse(readGolden(name, 'json')))
  })

  it.each([
    ['text without an Interchange header', "UNH+1+ORDERS:D:96A:UN:EAN008'UNT+2+1'"],
    [
      'an Interchange without its trailer',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'UNT+2+1'",
    ],
    [
      'a Message without its trailer',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+1'UNZ+1+1'",
    ],
    [
      'a Message trailer without its header',
      "UNB+UNOC:3+A+B+261014:0930+1'BGM+220+1'UNT+2+1'UNZ+1+1'",
    ],
  ])('rejects %s', (_case, text) => {
    expect(() => parse(text)).toThrow()
  })
})
