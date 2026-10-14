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
    [
      'a final segment without its terminator',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'UNT+2+1'UNZ+1+1'UNH+2",
    ],
    [
      'text after the last segment terminator',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'UNT+2+1'UNZ+1+1'\r\nEND",
    ],
  ])('rejects %s', (_case, text) => {
    expect(() => parse(text)).toThrow()
  })

  it.each([
    [
      'default delimiters',
      "UNB+UNOC:3+A+B+261014:0930+1'UNH+1+INVOIC:D:96A:UN:EAN008'FTX+AAI+++O?'NEIL ?+ SON??:NOTE?: 30 DAYS'UNT+3+1'UNZ+1+1'",
      ["O'NEIL + SON?", 'NOTE: 30 DAYS'],
    ],
    [
      'custom delimiters',
      'UNA|^,! ~UNB^UNOC|3^A^B^261014|0930^1~UNH^1^INVOIC|D|96A|UN|EAN008~FTX^AAI^^^O!~NEIL !^ SON!!|NOTE!| 30 DAYS~UNT^3^1~UNZ^1^1~',
      ['O~NEIL ^ SON!', 'NOTE| 30 DAYS'],
    ],
  ])('reads every released delimiter as text with %s', (_case, text, freeText) => {
    const interchange = parse(text)

    expect(interchange.messages[0]?.segments[0]?.elements[3]).toEqual(freeText)
  })

  it('treats a space in the UNA release position as no release character', () => {
    const interchange = parse(
      "UNA:+.  'UNB+UNOC:3+A B+C+261014:0930+1'UNH+1+ORDERS:D:96A:UN:EAN008'FTX+AAI+++O K'UNT+3+1'UNZ+1+1'",
    )

    expect(interchange.header.elements[1]).toEqual(['A B'])
    expect(interchange.messages[0]?.segments[0]?.elements[3]).toEqual(['O K'])
  })
})
