import type { Faker } from '@faker-js/faker'

import {
  type DocumentField,
  type DocumentStructure,
  type DocumentStructureNode,
  type MappingSample,
  type MessageType,
  withCheckDigit,
} from '@edi-bridge/contracts'

import { seedDocumentStructures } from './document-structure'
import {
  documentValues,
  type DocumentValues,
  type Entry,
  renderEdifact,
  renderJson,
} from './document-values'
import { randomGln } from './gln'
import {
  linkTemplates,
  type MappingDraftRecord,
  oriented,
  seedMappingDrafts,
  unpublishedDraftId,
} from './mapping'
import { messageTypeStructures } from './message-type-structure'
import { stableUuid } from './seed-id'
import { seededFaker } from './seeded-faker'
import { seedTradingPartners } from './trading-partner'
import { seedWorkspace } from './workspace'

// `entries` are the sample's values at the source side's structure paths, which the preview reads
// instead of parsing the Document again.
export type MappingSampleRecord = MappingSample & {
  mappingId: string
  entries: ReadonlyArray<Entry>
}

type Party = { name: string; gln: string }

type Variant = { lineCount: number; creditNote: boolean; rejected: boolean }

type Context = {
  faker: Faker
  partner: Party
  own: Party
  variant: Variant
  day: Date
}

const cities = ['Hamburg', 'Bremen', 'Hannover', 'Kiel', 'Lübeck', 'Rostock', 'Oldenburg']

const contacts = ['Anna Petersen', 'Jonas Albers', 'Lena Hansen', 'Mehmet Yılmaz', 'Frauke Ahrens']

const streets = ['Hafenstraße', 'Industrieweg', 'Am Markt', 'Lindenallee', 'Speicherstadt']

const products = [
  'Haferdrink Bio 1 l',
  'Roggenbrot 500 g',
  'Gouda jung 400 g',
  'Apfelsaft naturtrüb 1 l',
  'Bio-Eier 10 Stück',
  'Vollmilch 3,5 % 1 l',
  'Spreewaldgurken 720 ml',
  'Kaffee Crema 1 kg',
  'Mineralwasser still 6 x 1,5 l',
  'Butter 250 g',
]

function isoDay(day: Date, offset: number) {
  return new Date(day.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
}

const dayOffsets = new Map([
  ['despatchDate', 1],
  ['requestedDeliveryDate', 3],
  ['estimatedDeliveryDate', 3],
  ['deliveryDate', 3],
  ['paymentDueDate', 30],
])

function money(faker: Faker, min: number, max: number) {
  return faker.number.float({ min, max, fractionDigits: 2 })
}

// A restricted-circulation GS1 prefix (020–029) keeps the GTINs as fictional as the GLNs.
function gtin(faker: Faker) {
  return withCheckDigit(`02${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`)
}

function partyOf(context: Context, party: string): Party {
  return party === 'supplier' ? context.own : context.partner
}

function fieldValue(field: DocumentField, context: Context, index: number) {
  const { faker, day } = context

  const [party = '', name = ''] = field.path.includes('.')
    ? [field.path.split('.').at(-2)!.replace('[]', ''), field.path.split('.').at(-1)!]
    : ['', field.path]

  switch (name) {
    case 'gln':
      return ['buyer', 'supplier', 'invoicee'].includes(party)
        ? partyOf(context, party).gln
        : randomGln(faker)
    case 'senderGln':
      return context.partner.gln
    case 'recipientGln':
      return context.own.gln
    case 'name':
      return party === 'contact'
        ? faker.helpers.arrayElement(contacts)
        : party === 'shipTo' || party === 'deliveryParty'
          ? `${context.partner.name.split(' ')[0]} Filiale ${faker.helpers.arrayElement(cities)}`
          : partyOf(context, party).name
    case 'street':
      return `${faker.helpers.arrayElement(streets)} ${faker.number.int({ min: 1, max: 80 })}`
    case 'postalCode':
      return faker.string.numeric({ length: 5, allowLeadingZeros: false })
    case 'city':
      return faker.helpers.arrayElement(cities)
    case 'country':
      return 'DE'
    case 'vatId':
      return `DE${faker.string.numeric(9)}`
    case 'phone':
      return `+49 40 ${faker.string.numeric(7)}`
    case 'email':
      return `einkauf@${context.partner.name.split(' ')[0]!.toLowerCase()}.example`
    case 'orderNumber':
      return `PO-2026-${faker.string.numeric(5)}`
    case 'despatchNumber':
    case 'deliveryNoteNumber':
      return `DN-2026-${faker.string.numeric(5)}`
    case 'invoiceNumber':
      return `${context.variant.creditNote ? 'CN' : 'INV'}-2026-${faker.string.numeric(5)}`
    case 'contractNumber':
      return `CT-${faker.string.numeric(4)}`
    case 'interchangeReference':
    case 'messageReference':
      return faker.string.numeric(6)
    case 'currency':
      return 'EUR'
    case 'note':
      return 'Anlieferung bitte an Rampe 3.'
    case 'isCreditNote':
      return context.variant.creditNote
    case 'lineNumber':
    case 'packageNumber':
      return index + 1
    case 'parentPackageNumber':
      return 1
    case 'gtin':
      return gtin(faker)
    case 'sscc':
      return withCheckDigit(`302${faker.string.numeric(14)}`)
    case 'packageType':
      return 'PX'
    case 'supplierArticleNumber':
    case 'buyerArticleNumber':
      return `ART-${faker.string.numeric(5)}`
    case 'description':
      return faker.helpers.arrayElement(products)
    case 'quantity':
      return faker.number.int({ min: 1, max: 48 })
    case 'unit':
      return 'PCE'
    case 'netPrice':
      return money(faker, 0.5, 20)
    case 'vatRate':
    case 'rate':
      return faker.helpers.arrayElement([7, 19])
    case 'messageType':
      return 'ORDERS'
    case 'status':
      return context.variant.rejected ? '4' : '7'
    case 'syntaxError':
      return context.variant.rejected ? '12' : ''
    case 'position':
      return faker.number.int({ min: 2, max: 30 })
  }

  switch (field.type) {
    case 'date':
      return isoDay(day, dayOffsets.get(name) ?? 0)
    case 'number':
      return money(faker, 1, 999)
    case 'integer':
      return faker.number.int({ min: 1, max: 999 })
    case 'boolean':
      return faker.datatype.boolean()
    case 'string':
      return faker.lorem.word()
  }
}

function repeatCount(path: string, depth: number, context: Context) {
  if (path.endsWith('segmentErrors[]')) {
    return context.variant.rejected ? 1 : 0
  }

  if (path === 'messages[]') {
    return 1
  }

  if (path === 'packages[]') {
    return Math.max(1, Math.round(context.variant.lineCount / 2))
  }

  return depth === 0 ? context.variant.lineCount : 2
}

function nodeEntries(
  node: DocumentStructureNode,
  context: Context,
  at: ReadonlyArray<number>,
  index: number,
): Entry[] {
  switch (node.kind) {
    case 'field':
      return [{ path: node.path, at, value: String(fieldValue(node, context, index)) }]
    case 'object':
      return node.children.flatMap((child) => nodeEntries(child, context, at, index))
    case 'array':
      return Array.from({ length: repeatCount(node.path, at.length, context) }, (_, item) =>
        nodeEntries(node.items, context, [...at, item], item),
      ).flat()
  }
}

const cents = (value: number) => Math.round(value * 100) / 100

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const single = (path: string, value: number): Entry[] => [{ path, at: [], value: String(value) }]

// Amounts and counts follow from the lines, so a sample invoice adds up.
function withTotals(entries: ReadonlyArray<Entry>) {
  const values = documentValues(entries)
  const has = (path: string) => values.entries(path).length > 0

  const lines = values.entries('lines[].quantity').map(({ at, value }) => ({
    at,
    amount: cents(Number(value) * Number(values.get('lines[].netPrice', at) ?? 0)),
    rate: Number(values.get('lines[].vatRate', at) ?? 0),
  }))

  const derived = new Map<string, Entry[]>()

  if (has('lines[].lineAmount')) {
    derived.set(
      'lines[].lineAmount',
      lines.map(({ at, amount }) => ({ path: 'lines[].lineAmount', at, value: String(amount) })),
    )
  }

  if (has('lineCount')) {
    derived.set('lineCount', single('lineCount', lines.length))
  }

  if (has('totals.lineTotal')) {
    const rates = [...new Set(lines.map(({ rate }) => rate))].sort((a, b) => a - b)

    const breakdown = rates.map((rate) => ({
      rate,
      amount: cents(
        (sum(lines.filter((line) => line.rate === rate).map(({ amount }) => amount)) * rate) / 100,
      ),
    }))

    const lineTotal = cents(sum(lines.map(({ amount }) => amount)))
    const vatAmount = cents(sum(breakdown.map(({ amount }) => amount)))

    derived.set('totals.lineTotal', single('totals.lineTotal', lineTotal))
    derived.set('totals.taxableAmount', single('totals.taxableAmount', lineTotal))
    derived.set('totals.vatAmount', single('totals.vatAmount', vatAmount))
    derived.set('totals.invoiceTotal', single('totals.invoiceTotal', cents(lineTotal + vatAmount)))

    for (const field of ['rate', 'amount'] as const) {
      derived.set(
        `vatBreakdown[].${field}`,
        breakdown.map((row, item) => ({
          path: `vatBreakdown[].${field}`,
          at: [item],
          value: String(row[field]),
        })),
      )
    }
  }

  return [...entries.filter(({ path }) => !derived.has(path)), ...[...derived.values()].flat()]
}

const edifactDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replaceAll('-', '') : value

// Places the values of an ERP Document where the Trading Partner's EDIFACT carries them, by the
// same field and element pairs the seed Mappings link.
function edifactEntries(messageType: MessageType, entries: ReadonlyArray<Entry>): Entry[] {
  const elementOf = new Map(linkTemplates[messageType])

  return entries.flatMap(({ path, at, value }) => {
    const element = elementOf.get(path)

    return element ? [{ path: element, at, value: edifactDate(value) }] : []
  })
}

function envelope(message: string, context: Context, reference: string) {
  const stamp = context.day.toISOString().slice(2, 10).replaceAll('-', '')

  return [
    "UNA:+.? '",
    `UNB+UNOC:3+${context.partner.gln}:14+${context.own.gln}:14+${stamp}:0815+${reference}'`,
    message,
    `UNZ+1+${reference}'`,
  ].join('\n')
}

function partnerOf(mappingName: string, faker: Faker): Party {
  const short = mappingName.split(':')[0]!
  const found = seedTradingPartners.find(({ name }) => name.startsWith(short))

  return found
    ? { name: found.name, gln: found.gln }
    : { name: `${short} GmbH`, gln: randomGln(faker) }
}

const firstSampleDay = Date.parse('2026-10-05T00:00:00.000Z')

// The Document's own number, so an invoice is named after the invoice, not the order it refers to.
const numberFields = ['invoiceNumber', 'despatchNumber', 'orderNumber', 'interchangeReference']

function sampleName(values: DocumentValues, extension: string, index: number) {
  const number = numberFields
    .map((field) => values.get(field, []))
    .find((value) => value !== undefined)

  return `${(number ?? `sample-${index + 1}`).toLowerCase()}.${extension}`
}

export function createMappingSample({
  mapping,
  documentStructure,
  index = 0,
  lineCount = 3,
  creditNote = false,
  rejected = false,
}: {
  mapping: Pick<MappingDraftRecord, 'id' | 'name' | 'messageType'>
  documentStructure: DocumentStructure
  index?: number
  lineCount?: number
  creditNote?: boolean
  rejected?: boolean
}): MappingSampleRecord {
  const faker = seededFaker(`sample:${mapping.id}:${index}:${lineCount}`)

  const context: Context = {
    faker,
    partner: partnerOf(mapping.name, faker),
    own: { name: seedWorkspace.name, gln: seedWorkspace.gln ?? randomGln(faker) },
    variant: { lineCount, creditNote, rejected },
    day: new Date(firstSampleDay + index * 2 * 86_400_000),
  }

  const entries = withTotals(
    documentStructure.children.flatMap((node) => nodeEntries(node, context, [], 0)),
  )

  const values = documentValues(entries)
  const id = stableUuid(`${mapping.id}:sample:${index}:${lineCount}`)

  const jsonSample = (): MappingSampleRecord => ({
    id,
    mappingId: mapping.id,
    name: sampleName(values, 'json', index),
    document: { format: 'json', content: renderJson(documentStructure, values) },
    entries,
  })

  const edifactSample = (): MappingSampleRecord => {
    const edifact = edifactEntries(mapping.messageType, entries)
    const reference = faker.string.numeric(6)

    const message = renderEdifact(
      messageTypeStructures[mapping.messageType],
      documentValues(edifact),
      reference,
    )

    return {
      id,
      mappingId: mapping.id,
      name: sampleName(values, 'edi', index),
      document: { format: 'edifact', content: envelope(message, context, reference) },
      entries: edifact,
    }
  }

  return oriented(mapping.messageType, { document: jsonSample, edifact: edifactSample }).source()
}

const sampleVariants: Readonly<
  Record<
    MessageType,
    ReadonlyArray<Partial<Pick<Variant, 'lineCount' | 'creditNote' | 'rejected'>>>
  >
> = {
  ORDERS: [{ lineCount: 3 }, { lineCount: 12 }],
  DESADV: [{ lineCount: 4 }, { lineCount: 1 }],
  INVOIC: [{ lineCount: 3 }, { lineCount: 2, creditNote: true }],
  CONTRL: [{}, { rejected: true }],
}

function structureFor(mapping: MappingDraftRecord) {
  return seedDocumentStructures.find(({ id }) => id === mapping.documentStructureId)
}

// The Draft that has never been published has no samples yet, so the seed shows that state too.
export const seedMappingSamples: ReadonlyArray<MappingSampleRecord> = seedMappingDrafts
  .filter(({ id }) => id !== unpublishedDraftId)
  .flatMap((mapping) => {
    const documentStructure = structureFor(mapping)

    return documentStructure
      ? sampleVariants[mapping.messageType].map((variant, index) =>
          createMappingSample({ mapping, documentStructure, index, ...variant }),
        )
      : []
  })

export function toMappingSample({ id, name, document }: MappingSampleRecord): MappingSample {
  return { id, name, document }
}
