import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  type Delimiters,
  type Interchange,
  parse,
  ParseError,
  serialize,
  SerializeError,
  validate,
  ValidationError,
} from './index'

const goldenDirectory = (kind: string) => new URL(`../golden/${kind}/`, import.meta.url)

const goldenNames = (kind: string) =>
  readdirSync(goldenDirectory(kind))
    .filter((file) => file.endsWith('.edi'))
    .map((file) => file.slice(0, -'.edi'.length))

const readGolden = (kind: string, name: string, extension: string) =>
  readFileSync(new URL(`${name}.${extension}`, goldenDirectory(kind)), 'latin1')

const thrownBy = (action: () => void) => {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('The action finished without an error')
}

describe('parse', () => {
  it.each(goldenNames('valid'))('parses the valid Interchange %s', (name) => {
    expect(parse(readGolden('valid', name, 'edi'))).toEqual(
      JSON.parse(readGolden('valid', name, 'json')),
    )
  })

  it.each(goldenNames('broken'))('reports the error in the broken Interchange %s', (name) => {
    const error = thrownBy(() => parse(readGolden('broken', name, 'edi')))

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

describe('validate', () => {
  const ordersGoldenNames = goldenNames('valid').filter((name) => name.startsWith('orders-'))

  it.each(ordersGoldenNames)('accepts the valid Interchange %s', (name) => {
    expect(() => validate(parse(readGolden('valid', name, 'edi')))).not.toThrow()
  })

  it.each(goldenNames('invalid'))('reports the error in the invalid Interchange %s', (name) => {
    const interchange = parse(readGolden('invalid', name, 'edi'))
    const error = thrownBy(() => validate(interchange))

    expect(error).toBeInstanceOf(ValidationError)
    expect(error).toMatchObject(JSON.parse(readGolden('invalid', name, 'json')))
  })
})

describe('serialize', () => {
  it.each(goldenNames('valid'))('reproduces the valid Interchange %s byte for byte', (name) => {
    const text = readGolden('valid', name, 'edi')

    expect(serialize(parse(text))).toBe(text)
  })
})

describe('serialize an Interchange built by hand', () => {
  const builtInterchange = (delimiters: Delimiters): Interchange => ({
    hasServiceStringAdvice: false,
    delimiters,
    header: {
      tag: 'UNB',
      elements: [
        ['UNOC', '3'],
        ['4012345000016', '14'],
        ['5412345000013', '14'],
        ['261014', '0930'],
        ['CTL1'],
      ],
    },
    messages: [
      {
        header: { tag: 'UNH', elements: [['ME1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
        segments: [{ tag: 'FTX', elements: [['AAI'], [], [], ["O'NEIL + SON: 50% OFF"]] }],
        trailer: { tag: 'UNT', elements: [['3'], ['ME1']] },
      },
    ],
    trailer: { tag: 'UNZ', elements: [['1'], ['CTL1']] },
  })

  it('writes no line breaks and no UNA for default delimiters', () => {
    expect(
      serialize(
        builtInterchange({
          component: ':',
          element: '+',
          decimal: '.',
          release: '?',
          repetition: ' ',
          segment: "'",
        }),
      ),
    ).toBe(
      "UNB+UNOC:3+4012345000016:14+5412345000013:14+261014:0930+CTL1'UNH+ME1+ORDERS:D:96A:UN:EAN008'FTX+AAI+++O?'NEIL ?+ SON?: 50% OFF'UNT+3+ME1'UNZ+1+CTL1'",
    )
  })

  it('writes a UNA for delimiters that differ from the defaults', () => {
    expect(
      serialize(
        builtInterchange({
          component: '|',
          element: '^',
          decimal: ',',
          release: '!',
          repetition: ' ',
          segment: '~',
        }),
      ),
    ).toBe(
      "UNA|^,! ~UNB^UNOC|3^4012345000016|14^5412345000013|14^261014|0930^CTL1~UNH^ME1^ORDERS|D|96A|UN|EAN008~FTX^AAI^^^O'NEIL + SON: 50% OFF~UNT^3^ME1~UNZ^1^CTL1~",
    )
  })
})

describe('serialize without a release character', () => {
  it('rejects a value that contains a service character', () => {
    const interchange: Interchange = {
      hasServiceStringAdvice: true,
      delimiters: {
        component: ':',
        element: '+',
        decimal: '.',
        release: ' ',
        repetition: ' ',
        segment: "'",
      },
      header: { tag: 'UNB', elements: [['UNOC', '3'], ['A'], ['B'], ['261014', '0930'], ['1']] },
      messages: [
        {
          header: { tag: 'UNH', elements: [['1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
          segments: [{ tag: 'FTX', elements: [['AAI'], [''], [''], ['OK', "O'NEIL"]] }],
          trailer: { tag: 'UNT', elements: [['3'], ['1']] },
        },
      ],
      trailer: { tag: 'UNZ', elements: [['1'], ['1']] },
    }

    expect(() => serialize(interchange)).toThrow(SerializeError)
    expect(() => serialize(interchange)).toThrow(
      expect.objectContaining({
        code: 'unreleasable-service-character',
        position: { segment: 4, element: 4, component: 2 },
      }),
    )
  })
})
