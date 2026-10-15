import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { inferDocumentStructure, mappingVersionSchema, toEncodedFile } from '@edi-bridge/contracts'
import { type Interchange, type Message, serialize, validate } from '@edi-bridge/edifact'

import { applyMappingVersion, readDocument } from './index'

const golden = (name: string, encoding: BufferEncoding = 'utf8') =>
  readFileSync(new URL(`../golden/${name}`, import.meta.url), encoding)

const unitTable = {
  id: '2b7c4e91-5d3a-4f8e-b6c2-9a1d0e3f4b57',
  entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
}

function interchangeOf(message: Message): Interchange {
  const segmentCount = message.segments.length + 4

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
    header: {
      tag: 'UNB',
      elements: [
        ['UNOC', '3'],
        ['4389876511113', '14'],
        ['4071615111110', '14'],
        ['000320', '1200'],
        ['00000001'],
      ],
    },
    messages: [message],
    trailer: { tag: 'UNZ', elements: [['1'], ['00000001']] },
    whitespace: {
      lineBreaks: Array.from({ length: segmentCount }, (_, index) => (index === 0 ? '' : '\n')),
      trailingText: '\n',
    },
  }
}

describe('the reference invoice', () => {
  it('maps to the golden INVOIC, byte for byte, and passes validation', async () => {
    const text = golden('invoic-reference.document.json')
    const version = mappingVersionSchema.parse(JSON.parse(golden('invoic-reference.mapping.json')))

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
