import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parse, ParseError, serialize } from './index'

const goldenDirectory = (kind: string) => new URL(`../golden/${kind}/`, import.meta.url)

const goldenNames = (kind: string) =>
  readdirSync(goldenDirectory(kind))
    .filter((file) => file.endsWith('.edi'))
    .map((file) => file.slice(0, -'.edi'.length))

const readGolden = (kind: string, name: string, extension: string) =>
  readFileSync(new URL(`${name}.${extension}`, goldenDirectory(kind)), 'latin1')

const thrownBy = (text: string) => {
  try {
    parse(text)
  } catch (error) {
    return error
  }

  throw new Error('The Interchange was parsed without an error')
}

describe('parse', () => {
  it.each(goldenNames('valid'))('parses the valid Interchange %s', (name) => {
    expect(parse(readGolden('valid', name, 'edi'))).toEqual(
      JSON.parse(readGolden('valid', name, 'json')),
    )
  })

  it.each(goldenNames('broken'))('reports the error in the broken Interchange %s', (name) => {
    const error = thrownBy(readGolden('broken', name, 'edi'))

    expect(error).toBeInstanceOf(ParseError)
    expect(error).toMatchObject(JSON.parse(readGolden('broken', name, 'json')))
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

describe('serialize', () => {
  it.each(goldenNames('valid'))('reproduces the valid Interchange %s byte for byte', (name) => {
    const text = readGolden('valid', name, 'edi')

    expect(serialize(parse(text))).toBe(text)
  })
})
