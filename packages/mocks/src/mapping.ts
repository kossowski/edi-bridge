import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  directionOf,
  type DocumentStructure,
  type MappingDraft,
  mappingDraftEndpoint,
  mappingDraftSchema,
  type MappingGraph,
  type MappingLink,
  type MappingSide,
  mappingsEndpoint,
  type MappingSummary,
  mappingSummarySchema,
  type MappingTransform,
  mappingTransformSchema,
  type MessageType,
  messageTypes,
  saveMappingDraftEndpoint,
  type TransformConfig,
  type TransformKind,
  type TransformLink,
  transformLinkTargets,
  transformPorts,
} from '@edi-bridge/contracts'

import {
  documentStructureLeaves,
  seedDocumentStructureOf,
  seedDocumentStructures,
} from './document-structure'
import { seedMappings } from './flow'
import { seedLookupTableNamed } from './lookup-table'
import { edifactLeaves, messageTypeStructures } from './message-type-structure'
import { badRequest, notFound, unprocessable } from './responses'
import { seedId, stableUuid } from './seed-id'
import { seededFaker } from './seeded-faker'

export type MappingDraftRecord = {
  id: string
  name: string
  messageType: MessageType
  documentStructureId: string
  latestVersion: number | null
  links: ReadonlyArray<MappingLink>
  transforms: ReadonlyArray<MappingTransform>
  transformLinks: ReadonlyArray<TransformLink>
  updatedAt: string
}

type DocumentStructures = ReadonlyArray<DocumentStructure>

// Pairs of [ERP Document field, EDIFACT element], turned into links by `link`.
export const linkTemplates: Readonly<
  Record<MessageType, ReadonlyArray<readonly [string, string]>>
> = {
  ORDERS: [
    ['orderNumber', 'BGM/1004'],
    ['orderDate', 'DTM+137/C507/2380'],
    ['requestedDeliveryDate', 'DTM+2/C507/2380'],
    ['note', 'FTX+AAI/C108/4440'],
    ['contractNumber', 'SG1+CT/RFF+CT/C506/1154'],
    ['buyer.gln', 'SG2+BY/NAD+BY/C082/3039'],
    ['buyer.name', 'SG2+BY/NAD+BY/C080/3036'],
    ['buyer.street', 'SG2+BY/NAD+BY/C059/3042'],
    ['buyer.postalCode', 'SG2+BY/NAD+BY/3251'],
    ['buyer.city', 'SG2+BY/NAD+BY/3164'],
    ['buyer.country', 'SG2+BY/NAD+BY/3207'],
    ['buyer.vatId', 'SG2+BY/SG3/RFF+VA/C506/1154'],
    ['buyer.contact.name', 'SG2+BY/SG5/CTA+OC/C056/3412'],
    ['supplier.gln', 'SG2+SU/NAD+SU/C082/3039'],
    ['deliveryParty.gln', 'SG2+DP/NAD+DP/C082/3039'],
    ['invoicee.gln', 'SG2+IV/NAD+IV/C082/3039'],
    ['currency', 'SG7/CUX/C504/6345'],
    ['lines[].lineNumber', 'SG25/LIN/1082'],
    ['lines[].gtin', 'SG25/LIN/C212/7140'],
    ['lines[].supplierArticleNumber', 'SG25/PIA+1/C212/7140'],
    ['lines[].description', 'SG25/IMD+F/C273/7008'],
    ['lines[].quantity', 'SG25/QTY+21/C186/6060'],
    ['lines[].unit', 'SG25/QTY+21/C186/6411'],
    ['lines[].requestedDeliveryDate', 'SG25/DTM+2/C507/2380'],
    ['lines[].netPrice', 'SG25/SG28/PRI+AAA/C509/5118'],
    ['lineCount', 'CNT+2/C270/6066'],
  ],
  DESADV: [
    ['despatchNumber', 'BGM/1004'],
    ['documentDate', 'DTM+137/C507/2380'],
    ['despatchDate', 'DTM+11/C507/2380'],
    ['estimatedDeliveryDate', 'DTM+17/C507/2380'],
    ['orderNumber', 'SG1+ON/RFF+ON/C506/1154'],
    ['buyer.gln', 'SG2+BY/NAD+BY/C082/3039'],
    ['supplier.gln', 'SG2+SU/NAD+SU/C082/3039'],
    ['shipTo.gln', 'SG2+DP/NAD+DP/C082/3039'],
    ['shipTo.name', 'SG2+DP/NAD+DP/C080/3036'],
    ['packages[].packageNumber', 'SG10/CPS/7164'],
    ['packages[].parentPackageNumber', 'SG10/CPS/7166'],
    ['packages[].packageType', 'SG10/SG11/PAC/C202/7065'],
    ['packages[].sscc', 'SG10/SG11/SG13/SG15/GIN+BJ/C208/7402'],
    ['packages[].lines[].lineNumber', 'SG10/SG17/LIN/1082'],
    ['packages[].lines[].gtin', 'SG10/SG17/LIN/C212/7140'],
    ['packages[].lines[].supplierArticleNumber', 'SG10/SG17/PIA+1/C212/7140'],
    ['packages[].lines[].description', 'SG10/SG17/IMD+F/C273/7008'],
    ['packages[].lines[].quantity', 'SG10/SG17/QTY+12/C186/6060'],
  ],
  INVOIC: [
    ['invoiceNumber', 'BGM/1004'],
    ['invoiceDate', 'DTM+137/C507/2380'],
    ['deliveryDate', 'DTM+35/C507/2380'],
    ['orderNumber', 'SG1+ON/RFF+ON/C506/1154'],
    ['deliveryNoteNumber', 'SG1+DQ/RFF+DQ/C506/1154'],
    ['buyer.gln', 'SG2+BY/NAD+BY/C082/3039'],
    ['buyer.vatId', 'SG2+BY/SG3/RFF+VA/C506/1154'],
    ['supplier.gln', 'SG2+SU/NAD+SU/C082/3039'],
    ['supplier.vatId', 'SG2+SU/SG3/RFF+VA/C506/1154'],
    ['invoicee.gln', 'SG2+IV/NAD+IV/C082/3039'],
    ['shipTo.gln', 'SG2+DP/NAD+DP/C082/3039'],
    ['currency', 'SG7/CUX/C504/6345'],
    ['paymentDueDate', 'SG8/DTM+13/C507/2380'],
    ['lines[].lineNumber', 'SG25/LIN/1082'],
    ['lines[].gtin', 'SG25/LIN/C212/7140'],
    ['lines[].supplierArticleNumber', 'SG25/PIA+1/C212/7140'],
    ['lines[].description', 'SG25/IMD+F/C273/7008'],
    ['lines[].quantity', 'SG25/QTY+47/C186/6060'],
    ['lines[].lineAmount', 'SG25/SG26/MOA+203/C516/5004'],
    ['lines[].netPrice', 'SG25/SG28/PRI+AAA/C509/5118'],
    ['lines[].vatRate', 'SG25/SG33/TAX+7/C243/5278'],
    ['totals.invoiceTotal', 'SG48/MOA+77/C516/5004'],
    ['totals.lineTotal', 'SG48/MOA+79/C516/5004'],
    ['totals.taxableAmount', 'SG48/MOA+125/C516/5004'],
    ['totals.vatAmount', 'SG48/MOA+176/C516/5004'],
    ['vatBreakdown[].rate', 'SG50/TAX+7/C243/5278'],
    ['vatBreakdown[].amount', 'SG50/MOA+124/C516/5004'],
  ],
  CONTRL: [
    ['interchangeReference', 'UCI/0020'],
    ['senderGln', 'UCI/S002/0004'],
    ['recipientGln', 'UCI/S003/0010'],
    ['status', 'UCI/0083'],
    ['syntaxError', 'UCI/0085'],
    ['messages[].messageReference', 'SG1/UCM/0062'],
    ['messages[].messageType', 'SG1/UCM/S009/0065'],
    ['messages[].status', 'SG1/UCM/0083'],
    ['messages[].syntaxError', 'SG1/UCM/0085'],
    ['messages[].segmentErrors[].position', 'SG1/SG2/UCS/0096'],
    ['messages[].segmentErrors[].syntaxError', 'SG1/SG2/UCS/0085'],
  ],
}

// Inbound Mappings read the Message Type and write the Document, outbound ones the other way.
export function oriented<Side>(
  messageType: MessageType,
  { document, edifact }: { document: Side; edifact: Side },
): { source: Side; target: Side } {
  return directionOf({ messageType }) === 'inbound'
    ? { source: edifact, target: document }
    : { source: document, target: edifact }
}

function link(messageType: MessageType, [field, element]: readonly [string, string]): MappingLink {
  const { source, target } = oriented(messageType, { document: field, edifact: element })

  return { sourcePath: source, targetPath: target }
}

function templateLinks(messageType: MessageType, share: number): MappingLink[] {
  const template = linkTemplates[messageType]

  return template
    .slice(0, Math.round(template.length * share))
    .map((pair) => link(messageType, pair))
}

type TransformTemplate = {
  kind: TransformKind
  config: TransformConfig
  inputs?: Readonly<Record<string, string>>
  feedingTransformIndex?: Readonly<Record<string, number>>
  outputs?: Readonly<Record<string, string>>
}

function transformTemplate<Kind extends TransformKind>(
  kind: Kind,
  config: TransformConfig<Kind>,
  ends: Pick<TransformTemplate, 'inputs' | 'feedingTransformIndex' | 'outputs'> = {},
): TransformTemplate {
  return { kind, config, ...ends }
}

// Directions are fixed per Message Type: ORDERS and CONTRL come in, DESADV and INVOIC go out.
// Some nodes are deliberately configured wrongly, so the canvas has invalid nodes to show.
const transformTemplates: Readonly<Record<MessageType, ReadonlyArray<TransformTemplate>>> = {
  ORDERS: [
    transformTemplate(
      'concatenate',
      { inputCount: 2, separator: ' ' },
      {
        inputs: { part1: 'SG2+DP/NAD+DP/3251', part2: 'SG2+DP/NAD+DP/3164' },
        outputs: { value: 'deliveryParty.city' },
      },
    ),
    transformTemplate(
      'lookupTable',
      { lookupTableId: seedLookupTableNamed('Country codes').id, fallback: 'keepValue' },
      { inputs: { value: 'SG2+SU/NAD+SU/3207' }, outputs: { value: 'supplier.country' } },
    ),
    transformTemplate(
      'substring',
      { start: 0, length: 35 },
      { inputs: { value: 'SG2+SU/NAD+SU/C080/3036' }, outputs: { value: 'supplier.name' } },
    ),
    transformTemplate(
      'jsonata',
      { expression: '$string(SG25.PIA' },
      { outputs: { value: 'lines[].buyerArticleNumber' } },
    ),
    transformTemplate(
      'loop',
      { counterStart: 1 },
      { inputs: { items: 'SG25' }, outputs: { items: 'lines[]' } },
    ),
    transformTemplate('constant', { value: 'DE' }, { outputs: { value: 'invoicee.country' } }),
  ],
  DESADV: [
    transformTemplate('constant', { value: '351' }, { outputs: { value: 'BGM/C002/1001' } }),
    transformTemplate(
      'substring',
      { start: 0, length: 35 },
      { inputs: { value: 'shipTo.street' }, outputs: { value: 'SG2+DP/NAD+DP/C059/3042' } },
    ),
    transformTemplate(
      'lookupTable',
      { lookupTableId: null, fallback: 'fail' },
      { inputs: { value: 'shipTo.country' }, outputs: { value: 'SG2+DP/NAD+DP/3207' } },
    ),
    transformTemplate(
      'jsonata',
      { expression: '$count(packages.lines)' },
      { outputs: { value: 'CNT+2/C270/6066' } },
    ),
    transformTemplate(
      'loop',
      { counterStart: 1 },
      { inputs: { items: 'packages[]' }, outputs: { items: 'SG10' } },
    ),
    transformTemplate(
      'constant',
      { value: '' },
      { outputs: { value: 'SG10/SG17/QTY+12/C186/6411' } },
    ),
    transformTemplate(
      'concatenate',
      { inputCount: 2, separator: ' ' },
      {
        inputs: { part1: 'shipTo.postalCode', part2: 'shipTo.city' },
        outputs: { value: 'SG2+DP/NAD+DP/3164' },
      },
    ),
  ],
  INVOIC: [
    transformTemplate(
      'conditional',
      { operator: 'equals', compareTo: 'true' },
      {
        inputs: { value: 'isCreditNote' },
        feedingTransformIndex: { then: 1, else: 2 },
        outputs: { value: 'BGM/C002/1001' },
      },
    ),
    transformTemplate('constant', { value: '381' }),
    transformTemplate('constant', { value: '380' }),
    transformTemplate(
      'dateFormat',
      { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
      { inputs: { value: 'invoiceDate' }, outputs: { value: 'DTM+137/C507/2380' } },
    ),
    transformTemplate(
      'numberFormat',
      { decimalPlaces: 9, decimalSeparator: '.' },
      { inputs: { value: 'totals.invoiceTotal' }, outputs: { value: 'SG48/MOA+77/C516/5004' } },
    ),
    transformTemplate(
      'split',
      { separator: '', index: 0 },
      { inputs: { value: 'supplier.vatId' }, outputs: { value: 'SG2+SU/SG3/RFF+VA/C506/1154' } },
    ),
    transformTemplate(
      'jsonata',
      { expression: '$sum(lines.lineAmount)' },
      { outputs: { value: 'SG48/MOA+79/C516/5004' } },
    ),
    transformTemplate(
      'lookupTable',
      { lookupTableId: seedLookupTableNamed('VAT categories').id, fallback: 'fail' },
      { inputs: { value: 'lines[].vatRate' }, outputs: { value: 'SG25/SG33/TAX+7/C241/5153' } },
    ),
    transformTemplate(
      'loop',
      { counterStart: 1 },
      { inputs: { items: 'lines[]' }, outputs: { items: 'SG25', counter: 'SG25/LIN/1082' } },
    ),
  ],
  CONTRL: [
    transformTemplate(
      'conditional',
      { operator: 'equals', compareTo: '' },
      {
        inputs: { value: 'UCI/0083' },
        feedingTransformIndex: { then: 1, else: 2 },
        outputs: { value: 'status' },
      },
    ),
    transformTemplate('constant', { value: 'accepted' }),
    transformTemplate('constant', { value: 'rejected' }),
    transformTemplate(
      'concatenate',
      { inputCount: 1, separator: '' },
      { inputs: { part1: 'UCI/S002/0004' }, outputs: { value: 'senderGln' } },
    ),
  ],
}

type TransformGraph = Pick<MappingGraph, 'transforms' | 'transformLinks'>

function transformOnGrid(
  id: string,
  index: number,
  { kind, config }: TransformTemplate,
): MappingTransform {
  return mappingTransformSchema.parse({
    id,
    kind,
    config,
    position: { x: (index % 2) * 240, y: index * 120 },
  })
}

function templateGraph(mappingId: string, messageType: MessageType, share: number): TransformGraph {
  const template = transformTemplates[messageType]
  const chosen = template.slice(0, Math.round(template.length * share))
  const ids = chosen.map((_, index) => stableUuid(`${mappingId}:transform:${index}`))

  const transformLinks = chosen.flatMap(
    ({ inputs = {}, feedingTransformIndex = {}, outputs = {} }, index): TransformLink[] => {
      const into = (input: string) =>
        ({ kind: 'transform', transformId: ids[index]!, input }) as const

      return [
        ...Object.entries(inputs).map(([input, path]): TransformLink => ({
          from: { kind: 'source', path },
          to: into(input),
        })),
        ...Object.entries(feedingTransformIndex).flatMap(([input, feeding]): TransformLink[] => {
          const transformId = ids[feeding]

          return transformId
            ? [{ from: { kind: 'transform', transformId, output: 'value' }, to: into(input) }]
            : []
        }),
        ...Object.entries(outputs).map(([output, path]): TransformLink => ({
          from: { kind: 'transform', transformId: ids[index]!, output },
          to: { kind: 'target', path },
        })),
      ]
    },
  )

  return {
    transforms: chosen.map((transform, index) => transformOnGrid(ids[index]!, index, transform)),
    transformLinks,
  }
}

// A target takes one value, so a transform that fills it replaces the plain link into it.
function templateDraftGraph(mappingId: string, messageType: MessageType, share: number) {
  const graph = templateGraph(mappingId, messageType, share)
  const filled = new Set(transformLinkTargets(graph.transformLinks))

  return {
    ...graph,
    links: templateLinks(messageType, share).filter(({ targetPath }) => !filled.has(targetPath)),
  }
}

const firstDraftChange = Date.parse('2026-04-06T08:15:00.000Z')

function seedUpdatedAt(index: number) {
  return new Date(firstDraftChange + index * 5 * 86_400_000 + index * 3_600_000).toISOString()
}

export const unpublishedDraftId = seedId(7, 1)

// Each Message Type has one complete Draft, one half-done and one without links.
const linkShares = [1, 0.5, 0]

export const seedMappingDrafts: ReadonlyArray<MappingDraftRecord> = [
  ...seedMappings.map((mapping, index): MappingDraftRecord => {
    const newest = mapping.versions[0]!

    const sameTypeBefore = seedMappings
      .slice(0, index)
      .filter(({ messageType }) => messageType === mapping.messageType).length

    return {
      id: mapping.mappingId,
      name: newest.mappingName,
      messageType: mapping.messageType,
      documentStructureId: seedDocumentStructureOf[mapping.messageType].id,
      latestVersion: newest.version,
      ...templateDraftGraph(
        mapping.mappingId,
        mapping.messageType,
        linkShares[sameTypeBefore % linkShares.length]!,
      ),
      updatedAt: seedUpdatedAt(index),
    }
  }),
  {
    id: unpublishedDraftId,
    name: 'Spreewald: ERP JSON to INVOIC',
    messageType: 'INVOIC',
    documentStructureId: seedDocumentStructureOf.INVOIC.id,
    latestVersion: null,
    ...templateDraftGraph(unpublishedDraftId, 'INVOIC', 0.3),
    updatedAt: seedUpdatedAt(seedMappings.length),
  },
]

export function sideLeaves(
  record: MappingDraftRecord,
  documentStructures: DocumentStructures,
): { source: Set<string>; target: Set<string> } {
  const document = new Set(
    documentStructureLeaves(structureOf(record, documentStructures)).map(({ path }) => path),
  )

  const edifact = new Set(
    edifactLeaves(messageTypeStructures[record.messageType]).map(({ path }) => path),
  )

  return oriented(record.messageType, { document, edifact })
}

function randomLinks(
  faker: Faker,
  record: Pick<MappingDraftRecord, 'messageType'>,
  documentStructure: DocumentStructure,
): MappingLink[] {
  const fields = faker.helpers.shuffle(documentStructureLeaves(documentStructure))
  const elements = faker.helpers.shuffle(edifactLeaves(messageTypeStructures[record.messageType]))
  const count = Math.floor(Math.min(fields.length, elements.length) * 0.8)

  return Array.from({ length: count }, (_, index) =>
    link(record.messageType, [fields[index]!.path, elements[index]!.path]),
  )
}

const generatedConfigs: ReadonlyArray<Pick<TransformTemplate, 'kind' | 'config'>> = [
  { kind: 'substring', config: { start: 0, length: 35 } },
  { kind: 'dateFormat', config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' } },
  { kind: 'numberFormat', config: { decimalPlaces: 2, decimalSeparator: '.' } },
  { kind: 'split', config: { separator: '-', index: 0 } },
  { kind: 'lookupTable', config: { lookupTableId: null, fallback: 'keepValue' } },
  { kind: 'concatenate', config: { inputCount: 2, separator: ' ' } },
  { kind: 'conditional', config: { operator: 'isNotEmpty', compareTo: '' } },
  { kind: 'constant', config: { value: '' } },
  { kind: 'jsonata', config: { expression: '$now()' } },
]

// Drawn from its own faker, so adding transforms leaves the generated links as they were.
function randomGraph(
  record: Pick<MappingDraftRecord, 'id' | 'messageType'>,
  documentStructure: DocumentStructure,
  links: ReadonlyArray<MappingLink>,
): TransformGraph {
  const faker = seededFaker(`transforms:${record.id}`)

  const { source, target } = oriented(record.messageType, {
    document: documentStructureLeaves(documentStructure).map(({ path }) => path),
    edifact: edifactLeaves(messageTypeStructures[record.messageType]).map(({ path }) => path),
  })

  const linked = new Set(links.map(({ targetPath }) => targetPath))
  const unlinkedTargets = faker.helpers.shuffle(target.filter((path) => !linked.has(path)))

  const transforms = Array.from({ length: 30 }, (_, index) =>
    transformOnGrid(faker.string.uuid(), index, faker.helpers.arrayElement(generatedConfigs)),
  )

  const transformLinks = transforms.flatMap((transform, index): TransformLink[] => {
    const { inputs } = transformPorts(transform)
    const filledTarget = unlinkedTargets[index]

    return [
      ...inputs.map((input): TransformLink => ({
        from: { kind: 'source', path: faker.helpers.arrayElement(source) },
        to: { kind: 'transform', transformId: transform.id, input },
      })),
      ...(filledTarget
        ? [
            {
              from: { kind: 'transform', transformId: transform.id, output: 'value' },
              to: { kind: 'target', path: filledTarget },
            } as const,
          ]
        : []),
    ]
  })

  return { transforms, transformLinks }
}

// Cycles through the Message Types, so even two Drafts cover both directions.
export function createMappingDrafts({
  count,
  seed = 29,
  documentStructures,
}: {
  count: number
  seed?: number
  documentStructures?: DocumentStructures
}): MappingDraftRecord[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, (_, index) => {
    const messageType = messageTypes[index % messageTypes.length]!
    const company = faker.company.name().split(/[\s,]/)[0]

    const documentStructure = documentStructures
      ? faker.helpers.arrayElement(documentStructures)
      : seedDocumentStructureOf[messageType]

    const { source, target } = oriented(messageType, { document: 'ERP JSON', edifact: messageType })

    const record = {
      id: faker.string.uuid(),
      name: `${company}: ${source} to ${target}`,
      messageType,
      documentStructureId: documentStructure.id,
      latestVersion: faker.datatype.boolean({ probability: 0.8 })
        ? faker.number.int({ min: 1, max: 9 })
        : null,
      updatedAt: faker.date.between({ from: '2026-01-01', to: '2026-09-30' }).toISOString(),
    }

    if (!documentStructures) {
      const share = faker.helpers.arrayElement([1, 0.75, 0.5, 0.25, 0])

      return { ...record, ...templateDraftGraph(record.id, messageType, share) }
    }

    const links = randomLinks(faker, record, documentStructure)

    return { ...record, links, ...randomGraph(record, documentStructure, links) }
  })
}

function structureOf(
  record: Pick<MappingDraftRecord, 'id' | 'documentStructureId'>,
  documentStructures: DocumentStructures,
) {
  const found = documentStructures.find(({ id }) => id === record.documentStructureId)

  if (!found) {
    throw new Error(
      `Mapping ${record.id} uses the unknown Document Structure ${record.documentStructureId}`,
    )
  }

  return found
}

export function toMappingSummary(
  record: MappingDraftRecord,
  documentStructures: DocumentStructures,
): MappingSummary {
  return mappingSummarySchema.parse({
    id: record.id,
    name: record.name,
    direction: directionOf(record),
    messageType: record.messageType,
    documentStructureId: record.documentStructureId,
    documentStructureName: structureOf(record, documentStructures).name,
    latestVersion: record.latestVersion,
    draftUpdatedAt: record.updatedAt,
  })
}

export function toMappingDraft(
  record: MappingDraftRecord,
  documentStructures: DocumentStructures,
): MappingDraft {
  return mappingDraftSchema.parse({
    mappingId: record.id,
    name: record.name,
    direction: directionOf(record),
    links: record.links,
    transforms: record.transforms,
    transformLinks: record.transformLinks,
    updatedAt: record.updatedAt,
    ...oriented<MappingSide>(record.messageType, {
      document: {
        kind: 'documentStructure',
        documentStructureId: record.documentStructureId,
        name: structureOf(record, documentStructures).name,
      },
      edifact: { kind: 'messageType', messageType: record.messageType },
    }),
  })
}

export type MappingDraftStore = {
  all: () => readonly MappingDraftRecord[]
  get: (id: string) => MappingDraftRecord | undefined
  set: (mapping: MappingDraftRecord) => void
}

export function createMappingDraftStore(
  mappings: ReadonlyArray<MappingDraftRecord> = seedMappingDrafts,
): MappingDraftStore {
  const byId = new Map(mappings.map((mapping) => [mapping.id, mapping]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (mapping) => {
      byId.set(mapping.id, mapping)
    },
  }
}

export function toMappingDraftStore(
  mappings: ReadonlyArray<MappingDraftRecord> | MappingDraftStore = seedMappingDrafts,
) {
  return 'get' in mappings ? mappings : createMappingDraftStore(mappings)
}

function containerOf(leaves: ReadonlySet<string>, path: string) {
  return [...leaves].some((leaf) => leaf.startsWith(`${path}/`) || leaf.startsWith(`${path}.`))
}

type LinkedPath = { path: string; wholePart: boolean }

export function unknownPaths(graph: MappingGraph, leaves: ReturnType<typeof sideLeaves>) {
  const loops = new Set(graph.transforms.flatMap(({ id, kind }) => (kind === 'loop' ? [id] : [])))

  // A loop takes a whole repeated part and fills one; every other link ends at a field or element.
  const sourcePaths: LinkedPath[] = [
    ...graph.links.map(({ sourcePath }) => ({ path: sourcePath, wholePart: false })),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      from.kind === 'source'
        ? [
            {
              path: from.path,
              wholePart:
                to.kind === 'transform' && loops.has(to.transformId) && to.input === 'items',
            },
          ]
        : [],
    ),
  ]

  const targetPaths: LinkedPath[] = [
    ...graph.links.map(({ targetPath }) => ({ path: targetPath, wholePart: false })),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      to.kind === 'target'
        ? [
            {
              path: to.path,
              wholePart:
                from.kind === 'transform' && loops.has(from.transformId) && from.output === 'items',
            },
          ]
        : [],
    ),
  ]

  const missing = (side: ReadonlySet<string>) => (linked: LinkedPath) =>
    !side.has(linked.path) && !(linked.wholePart && containerOf(side, linked.path))
      ? [linked.path]
      : []

  return {
    source: new Set(sourcePaths.flatMap(missing(leaves.source))),
    target: new Set(targetPaths.flatMap(missing(leaves.target))),
  }
}

export function linkProblem(graph: MappingGraph, leaves: ReturnType<typeof sideLeaves>) {
  const unknown = unknownPaths(graph, leaves)
  const [unknownSource] = unknown.source
  const [unknownTarget] = unknown.target

  if (unknownSource !== undefined) {
    return unprocessable(`The source has no field or element at ${unknownSource}`)
  }

  if (unknownTarget !== undefined) {
    return unprocessable(`The target has no field or element at ${unknownTarget}`)
  }

  return null
}

export function mappingHandlers(
  apiUrl: string,
  {
    mappings = seedMappingDrafts,
    documentStructures = seedDocumentStructures,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    documentStructures?: DocumentStructures
  } = {},
) {
  const store = toMappingDraftStore(mappings)

  return [
    http.get(`${apiUrl}${mappingsEndpoint.path}`, () =>
      HttpResponse.json(
        store
          .all()
          .map((record) => toMappingSummary(record, documentStructures))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      ),
    ),
    http.get<{ id: string }>(`${apiUrl}${mappingDraftEndpoint.path}`, ({ params }) => {
      const record = store.get(params.id)

      return record ? HttpResponse.json(toMappingDraft(record, documentStructures)) : notFound()
    }),
    http.put<{ id: string }>(
      `${apiUrl}${saveMappingDraftEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        const body = saveMappingDraftEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const invalidLink = linkProblem(body.data, sideLeaves(existing, documentStructures))

        if (invalidLink) {
          return invalidLink
        }

        const record = { ...existing, ...body.data, updatedAt: new Date().toISOString() }
        store.set(record)

        return HttpResponse.json(toMappingDraft(record, documentStructures))
      },
    ),
  ]
}
