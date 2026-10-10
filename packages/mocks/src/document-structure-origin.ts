import {
  type CharacterEncoding,
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureOrigin,
  type EncodedFile,
} from '@edi-bridge/contracts'

import { encodeBase64 } from './document-structure-inference'
import { seededFaker } from './seeded-faker'

const windows1252Extras = new Map([
  ['€', 0x80],
  ['„', 0x84],
  ['“', 0x93],
])

export function encodeText(text: string, encoding: CharacterEncoding): Uint8Array {
  if (encoding === 'utf-8') {
    return new TextEncoder().encode(text)
  }

  return Uint8Array.from(text, (character) => {
    const code = character.codePointAt(0)!

    const byte =
      code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : windows1252Extras.get(character)

    if (byte === undefined) {
      throw new Error(`${character} has no Windows-1252 byte in the mocks`)
    }

    return byte
  })
}

export function toEncodedFile(
  fileName: string,
  text: string,
  encoding: CharacterEncoding = 'utf-8',
): EncodedFile {
  return { fileName, content: encodeBase64(encodeText(text, encoding)) }
}

const orderJson = JSON.stringify(
  {
    orderNumber: 'PO-2026-10417',
    orderDate: '2026-10-02',
    currency: 'EUR',
    note: null,
    buyer: { gln: '4012345000016', name: 'Hansemarkt GmbH', city: 'Lübeck' },
    lines: [
      { lineNumber: 1, gtin: '04012345123456', quantity: 24, netPrice: 1.89, promotion: true },
      { lineNumber: 2, gtin: '04012345654321', quantity: 12.5, netPrice: 3 },
    ],
    tags: ['express'],
  },
  null,
  2,
)

const orderListJson = JSON.stringify(
  [
    { orderNumber: 'PO-2026-10417', orderDate: '2026-10-02', total: 45.36 },
    { orderNumber: 'PO-2026-10418', orderDate: '2026-10-03', total: 120, note: 'Rampe 2' },
  ],
  null,
  2,
)

const dispatchCsv = [
  'Lieferscheinnummer;Lieferdatum;Kunde;Straße;Ort;GTIN;Menge;Bemerkung',
  'LS-88121;03.10.2026;Hansemarkt GmbH;Königstraße 12;Lübeck;04012345123456;24;',
  'LS-88121;03.10.2026;Hansemarkt GmbH;Königstraße 12;Lübeck;04012345654321;12,5;"Kühlware; „bitte zügig“"',
  'LS-88122;04.10.2026;Alpenfrisch Märkte AG;Maximilianstraße 3;München;04012345777777;6;Größe XL',
].join('\r\n')

const articleSchema = JSON.stringify(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['articleNumber', 'gtin', 'description', 'prices'],
    properties: {
      articleNumber: { type: 'string' },
      gtin: { type: 'string', pattern: '^\\d{14}$' },
      description: { type: 'string' },
      validFrom: { type: 'string', format: 'date' },
      discontinued: { type: ['boolean', 'null'] },
      unit: { enum: ['PCE', 'KGM', 'LTR'] },
      supplier: { $ref: '#/$defs/party' },
      prices: { type: 'array', items: { $ref: '#/$defs/price' } },
      keywords: { type: 'array', items: { type: 'string' } },
    },
    $defs: {
      party: {
        type: 'object',
        required: ['gln'],
        properties: { gln: { type: 'string' }, name: { type: 'string' } },
      },
      price: {
        type: 'object',
        required: ['amount', 'currency'],
        properties: {
          amount: { type: 'number' },
          currency: { type: 'string' },
          minimumQuantity: { type: 'integer' },
        },
      },
    },
  },
  null,
  2,
)

export const windows1252CsvSettings: CsvSettings = {
  ...defaultCsvSettings,
  encoding: 'windows-1252',
}

export const documentStructureOrigins = {
  jsonDocument: { kind: 'jsonDocument', document: toEncodedFile('order.json', orderJson) },
  jsonListDocument: {
    kind: 'jsonDocument',
    document: toEncodedFile('orders.json', orderListJson),
  },
  csvDocument: {
    kind: 'csvDocument',
    document: toEncodedFile('lieferscheine.csv', dispatchCsv),
    csv: defaultCsvSettings,
  },
  windows1252CsvDocument: {
    kind: 'csvDocument',
    document: toEncodedFile('lieferscheine-ansi.csv', dispatchCsv, 'windows-1252'),
    csv: windows1252CsvSettings,
  },
  jsonSchema: {
    kind: 'jsonSchema',
    jsonSchema: toEncodedFile('article.schema.json', articleSchema),
  },
  invalidJsonDocument: {
    kind: 'jsonDocument',
    document: toEncodedFile('broken.json', '{ "orderNumber": "PO-1", '),
  },
  emptyCsvDocument: {
    kind: 'csvDocument',
    document: toEncodedFile('empty.csv', '\r\n'),
    csv: defaultCsvSettings,
  },
  invalidJsonSchema: {
    kind: 'jsonSchema',
    jsonSchema: toEncodedFile('broken.schema.json', '{ "type": "object", "properties": [] }'),
  },
} as const satisfies Record<string, DocumentStructureOrigin>

export function createCsvDocument({
  rowCount,
  encoding = 'utf-8',
  seed = 'csv',
}: {
  rowCount: number
  encoding?: CharacterEncoding
  seed?: string
}): EncodedFile {
  const faker = seededFaker(`${seed}:${rowCount}`)
  const cities = ['München', 'Köln', 'Düsseldorf', 'Nürnberg', 'Lübeck', 'Würzburg', 'Göttingen']

  const rows = Array.from({ length: rowCount }, (_, index) =>
    [
      `LS-${90_000 + Math.floor(index / 8)}`,
      `${String(faker.number.int({ min: 1, max: 28 })).padStart(2, '0')}.10.2026`,
      faker.company.name().replaceAll(';', ''),
      faker.helpers.arrayElement(cities),
      `0${faker.string.numeric(13)}`,
      String(faker.number.int({ min: 1, max: 500 })),
      faker.datatype.boolean({ probability: 0.2 }) ? 'Kühlware' : '',
    ].join(';'),
  )

  return toEncodedFile(
    `lieferscheine-${rowCount}.csv`,
    ['Lieferscheinnummer;Lieferdatum;Kunde;Ort;GTIN;Menge;Bemerkung', ...rows].join('\r\n'),
    encoding,
  )
}
