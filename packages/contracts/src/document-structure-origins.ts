import {
  type CharacterEncoding,
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureOrigin,
  type EncodedFile,
} from './document-structure'
import { encodeBase64 } from './document-structure-inference'

const windows1252Decoder = new TextDecoder('windows-1252')

const windows1252Bytes = new Map(
  Array.from({ length: 256 }, (_, byte) => [windows1252Decoder.decode(Uint8Array.of(byte)), byte]),
)

export class UnencodableCharacterError extends Error {
  constructor(
    readonly character: string,
    readonly index: number,
  ) {
    super(`${character} has no Windows-1252 byte`)
    this.name = 'UnencodableCharacterError'
  }
}

export function encodeText(text: string, encoding: CharacterEncoding): Uint8Array {
  if (encoding === 'utf-8') {
    return new TextEncoder().encode(text)
  }

  const bytes: number[] = []
  let index = 0

  for (const character of text) {
    const byte = windows1252Bytes.get(character)

    if (byte === undefined) {
      throw new UnencodableCharacterError(character, index)
    }

    bytes.push(byte)
    index += character.length
  }

  return Uint8Array.from(bytes)
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

const invoiceCsv = [
  'RechNr;RechDatum;AuftrNr;KdNr;ArtNr;Bezeichnung;Menge;ME;EPreis;Netto;MwSt;Whg',
  'R-2026-1188;08.10.2026;4711;K-20931;4006381333931;Haferdrink 1 l;24;KRT;4,20;100,80;19;EUR',
  'R-2026-1188;08.10.2026;4711;K-20931;4006381333948;Haferdrink Barista 1 l;12;KRT;4,60;55,20;19;EUR',
  'R-2026-1189;08.10.2026;4712;K-11872;4006381333955;Dinkeldrink 1 l;6;ST;2,10;12,60;7;EUR',
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
  invoiceCsvDocument: {
    kind: 'csvDocument',
    document: toEncodedFile('Rechnungsexport_2026-10-08.csv', invoiceCsv),
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
