import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  adjustDocumentStructure,
  type DocumentStructureOrigin,
  encodeBase64,
  inferDocumentStructure,
  type MappingVersion,
  mappingVersionSchema,
  toEncodedFile,
} from '@edi-bridge/contracts'
import {
  type Interchange,
  type Message,
  parse,
  type Segment,
  serialize,
  validate,
} from '@edi-bridge/edifact'

import {
  applyInboundMappingVersion,
  applyMappingVersion,
  type InboundMappingVersion,
  readDocument,
  writeDocument,
} from './index'

const golden = (name: string, encoding: BufferEncoding = 'utf8') =>
  readFileSync(new URL(`../golden/${name}`, import.meta.url), encoding)

const goldenBytes = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url)))

const goldenVersion = (name: string): MappingVersion =>
  mappingVersionSchema.parse(JSON.parse(golden(name)))

const unitTable = {
  id: '2b7c4e91-5d3a-4f8e-b6c2-9a1d0e3f4b57',
  entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
}

const interchangeHeader: Segment = {
  tag: 'UNB',
  elements: [
    ['UNOC', '3'],
    ['4389876511113', '14'],
    ['4071615111110', '14'],
    ['000320', '1200'],
    ['00000001'],
  ],
}

const interchangeTrailer: Segment = { tag: 'UNZ', elements: [['1'], ['00000001']] }

function interchangeOf(message: Message): Interchange {
  const segments = [
    interchangeHeader,
    message.header,
    ...message.segments,
    message.trailer,
    interchangeTrailer,
  ]

  return {
    hasServiceStringAdvice: false,
    delimiters: {
      component: ':',
      element: '+',
      decimal: '.',
      release: '?',
      repetition: ' ',
      segment: "'",
    },
    header: interchangeHeader,
    messages: [message],
    trailer: interchangeTrailer,
    whitespace: {
      lineBreaks: segments.map((_, index) => (index === 0 ? '' : '\n')),
      trailingText: '\n',
    },
  }
}

describe('the reference invoice', () => {
  it('maps to the golden INVOIC, byte for byte, and passes validation', async () => {
    const text = golden('invoic-reference.document.json')
    const version = goldenVersion('invoic-reference.mapping.json')

    const structure = inferDocumentStructure({
      kind: 'jsonDocument',
      document: toEncodedFile('invoic-reference.document.json', text),
    })

    if (version.direction !== 'outbound') {
      throw new Error('The reference Mapping Version is not outbound')
    }

    const message = await Effect.runPromise(
      Effect.flatMap(readDocument(structure, text), (document) =>
        applyMappingVersion(version, document, {
          lookupTables: new Map([[unitTable.id, unitTable.entries]]),
        }),
      ),
    )

    const interchange = interchangeOf(message)

    expect(() => validate(interchange)).not.toThrow()
    expect(serialize(interchange)).toBe(golden('invoic-reference.edi', 'latin1'))
  })
})

const orderUnitTable = {
  id: '6d2e8f41-3b5c-4a7d-9e1f-2c4b6a8d0e13',
  entries: [{ sourceCode: 'PCE', targetCode: 'ST' }],
}

function inboundVersion(name: string): InboundMappingVersion {
  const version = goldenVersion(name)

  if (version.direction !== 'inbound') {
    throw new Error(`The reference Mapping Version ${name} is not inbound`)
  }

  return version
}

describe('the reference order', () => {
  const interchange = parse(golden('orders-reference.edi', 'latin1'))

  it('passes validation', () => {
    expect(() => validate(interchange)).not.toThrow()
  })

  it.each([
    {
      target: 'JSON',
      mappingVersion: 'orders-reference-json.mapping.json',
      document: 'orders-reference.document.json',
      adjustments: [],
      origin: (content: string): DocumentStructureOrigin => ({
        kind: 'jsonDocument',
        document: { fileName: 'orders-reference.document.json', content },
      }),
    },
    {
      target: 'CSV',
      mappingVersion: 'orders-reference-csv.mapping.json',
      document: 'orders-reference.document.csv',
      adjustments: [{ path: 'rows[].Preis', type: 'string' as const }],
      origin: (content: string): DocumentStructureOrigin => ({
        kind: 'csvDocument',
        document: { fileName: 'orders-reference.document.csv', content },
        csv: { delimiter: ';', headerRow: true, encoding: 'windows-1252' },
      }),
    },
  ])(
    'maps to the golden $target Document, byte for byte',
    async ({ mappingVersion, document, origin, adjustments }) => {
      const expected = goldenBytes(document)
      const version = inboundVersion(mappingVersion)
      const { documentStructureId: id, name } = version.target

      const structure = adjustDocumentStructure(
        { ...inferDocumentStructure(origin(encodeBase64(expected))), id, name },
        { name, adjustments },
      )

      const [message] = interchange.messages

      const written = await Effect.runPromise(
        Effect.flatMap(
          applyInboundMappingVersion(version, structure, message!, {
            lookupTables: new Map([[orderUnitTable.id, orderUnitTable.entries]]),
          }),
          (content) => writeDocument(structure, content),
        ),
      )

      expect(written).toEqual(expected)
    },
  )
})
