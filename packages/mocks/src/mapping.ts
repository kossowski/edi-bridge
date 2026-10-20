import { en, Faker } from '@faker-js/faker'
import { delay, http, HttpResponse } from 'msw'

import {
  type AiReview,
  createMappingEndpoint,
  directionOf,
  type DocumentStructure,
  documentStructureLeaves,
  edifactLeaves,
  type MappingDraft,
  mappingDraftEndpoint,
  mappingDraftSchema,
  mappingSideLeaves,
  type MappingGraph,
  type MappingLink,
  mappingsEndpoint,
  type MappingSummary,
  mappingSummarySchema,
  type MappingTransform,
  mappingTransformSchema,
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type MessageType,
  messageTypes,
  messageTypeStructures,
  oriented,
  remainingAiReview,
  type RunStatus,
  type RunSummary,
  type SideLeaves,
  saveMappingDraftEndpoint,
  type TradingPartner,
  type TradingPartnerSummary,
  type TransformConfig,
  type TransformKind,
  transformIssues,
  type TransformLink,
  transformLinkTargets,
  transformPorts,
  unknownPathMessage,
} from '@edi-bridge/contracts'

import {
  type DocumentStructureStore,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedInvoiceExportDocumentStructure,
  toDocumentStructureStore,
} from './document-structure'
import {
  createFlows,
  type FlowRecord,
  type FlowStore,
  seedFlows,
  seedMappings,
  toFlowStore,
} from './flow'
import {
  type LookupTableRecord,
  type LookupTableStore,
  seedLookupTableNamed,
  seedLookupTables,
  toLookupTableStore,
} from './lookup-table-seed'
import { day } from './overdue'
import { badRequest, notFound, serverError, unprocessable } from './responses'
import { seedRuns, toRunSummary } from './run'
import { type RunStore, toRunStore } from './run-store'
import { seedId, stableUuid } from './seed-id'
import { seededFaker } from './seeded-faker'
import {
  seedTradingPartners,
  type TradingPartnerStore,
  toTradingPartnerStore,
} from './trading-partner'

export type MappingDraftRecord = {
  id: string
  name: string
  messageType: MessageType
  documentStructureId: string
  latestVersion: number | null
  unpublishedChanges: boolean
  links: ReadonlyArray<MappingLink>
  transforms: ReadonlyArray<MappingTransform>
  transformLinks: ReadonlyArray<TransformLink>
  updatedAt: string
  aiReview?: AiReview | null
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
    ['lines[].description', 'SG25/IMD+A/C273/7008'],
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
    ['packages[].lines[].description', 'SG10/SG17/IMD+A/C273/7008'],
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
    ['lines[].description', 'SG25/IMD+A/C273/7008'],
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

export function link(
  messageType: MessageType,
  [field, element]: readonly [string, string],
): MappingLink {
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
      { outputs: { value: 'SG10/SG17/QTY+12/C186/6063' } },
    ),
    transformTemplate(
      'concatenate',
      { inputCount: 2, separator: ' ' },
      {
        inputs: { part1: 'shipTo.postalCode', part2: 'shipTo.city' },
        outputs: { value: 'SG2+DP/NAD+DP/3164' },
      },
    ),
    transformTemplate(
      'lookupTable',
      { lookupTableId: seedLookupTableNamed('Units of measure').id, fallback: 'fail' },
      {
        inputs: { value: 'packages[].lines[].unit' },
        outputs: { value: 'SG10/SG17/QTY+12/C186/6411' },
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
    transformTemplate(
      'lookupTable',
      { lookupTableId: seedLookupTableNamed('Units of measure').id, fallback: 'fail' },
      { inputs: { value: 'lines[].unit' }, outputs: { value: 'SG25/QTY+47/C186/6411' } },
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

export type TransformGraph = Pick<MappingGraph, 'transforms' | 'transformLinks'>

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

export function templateGraph(
  mappingId: string,
  messageType: MessageType,
  share: number,
  idKey = 'transform',
  extra: ReadonlyArray<TransformTemplate> = [],
): TransformGraph {
  const template = transformTemplates[messageType]
  const chosen = [...template.slice(0, Math.round(template.length * share)), ...extra]
  const ids = chosen.map((_, index) => stableUuid(`${mappingId}:${idKey}:${index}`))

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

// Dropping a transform can leave the one it fed unconnected, so this repeats until none is left.
export function withoutInvalidTransforms(graph: TransformGraph): TransformGraph {
  const invalid = new Set(
    Object.entries(transformIssues(graph))
      .filter(([, issues]) => issues.length > 0)
      .map(([id]) => id),
  )

  if (invalid.size === 0) {
    return graph
  }

  const touchesInvalid = ({ from, to }: TransformLink) =>
    (from.kind === 'transform' && invalid.has(from.transformId)) ||
    (to.kind === 'transform' && invalid.has(to.transformId))

  return withoutInvalidTransforms({
    transforms: graph.transforms.filter(({ id }) => !invalid.has(id)),
    transformLinks: graph.transformLinks.filter((transformLink) => !touchesInvalid(transformLink)),
  })
}

// A target takes one value, so a transform that fills it replaces the plain link into it.
function templateDraftGraph(
  mappingId: string,
  messageType: MessageType,
  share: number,
  {
    publishable = false,
    extra = [],
  }: { publishable?: boolean; extra?: ReadonlyArray<TransformTemplate> | undefined } = {},
) {
  const template = templateGraph(mappingId, messageType, share, 'transform', extra)
  const graph = publishable ? withoutInvalidTransforms(template) : template
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
const seedDraftStages = [
  { linkShare: 1, unpublishedChanges: false },
  { linkShare: 0.5, unpublishedChanges: true },
  { linkShare: 0, unpublishedChanges: false },
]

function seedDraftStageOf(index: number) {
  const { messageType } = seedMappings[index]!

  const sameTypeBefore = seedMappings
    .slice(0, index)
    .filter((mapping) => mapping.messageType === messageType).length

  return seedDraftStages[sameTypeBefore % seedDraftStages.length]!
}

// Elbtal orders in its own units, which only its Mapping translates.
const partnerTransforms = new Map<string, ReadonlyArray<TransformTemplate>>([
  [
    'Elbtal: ORDERS to ERP JSON',
    [
      transformTemplate(
        'lookupTable',
        { lookupTableId: seedLookupTableNamed('Elbtal order units').id, fallback: 'fail' },
        { inputs: { value: 'SG25/QTY+21/C186/6411' }, outputs: { value: 'lines[].unit' } },
      ),
    ],
  ],
])

// Only this half-done Draft keeps its invalid transform, so publishing it answers 422.
export const incompleteDraftId = seedMappings.find(
  ({ messageType }, index) =>
    messageType === 'INVOIC' && seedDraftStageOf(index).unpublishedChanges,
)!.mappingId

export const seedMappingDrafts: ReadonlyArray<MappingDraftRecord> = [
  ...seedMappings.map((mapping, index): MappingDraftRecord => {
    const newest = mapping.versions[0]!
    const { linkShare, unpublishedChanges } = seedDraftStageOf(index)

    return {
      id: mapping.mappingId,
      name: newest.mappingName,
      messageType: mapping.messageType,
      documentStructureId: seedDocumentStructureOf[mapping.messageType].id,
      latestVersion: newest.version,
      unpublishedChanges,
      ...templateDraftGraph(mapping.mappingId, mapping.messageType, linkShare, {
        publishable: unpublishedChanges && mapping.mappingId !== incompleteDraftId,
        extra: partnerTransforms.get(newest.mappingName),
      }),
      updatedAt: seedUpdatedAt(index),
    }
  }),
  {
    id: unpublishedDraftId,
    name: 'Spreewald: ERP CSV to INVOIC',
    messageType: 'INVOIC',
    documentStructureId: seedInvoiceExportDocumentStructure.id,
    latestVersion: null,
    unpublishedChanges: true,
    ...templateDraftGraph(unpublishedDraftId, 'INVOIC', 0),
    updatedAt: seedUpdatedAt(seedMappings.length),
  },
]

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

  const leaves = mappingSideLeaves(record.messageType, documentStructure)
  const source = [...leaves.source]

  const linked = new Set(links.map(({ targetPath }) => targetPath))

  const unlinkedTargets = faker.helpers.shuffle(
    [...leaves.target].filter((path) => !linked.has(path)),
  )

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

const changedDraftEvery = 3

function hasUnpublishedChanges(index: number, latestVersion: number | null) {
  return latestVersion === null || index % changedDraftEvery === 0
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

    const id = faker.string.uuid()

    const latestVersion = faker.datatype.boolean({ probability: 0.8 })
      ? faker.number.int({ min: 1, max: 9 })
      : null

    const record = {
      id,
      name: `${company}: ${source} to ${target}`,
      messageType,
      documentStructureId: documentStructure.id,
      latestVersion,
      unpublishedChanges: hasUnpublishedChanges(index, latestVersion),
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

const week = 7 * day

const trafficStatuses = [
  { value: 'delivered', weight: 85 },
  { value: 'failed', weight: 10 },
  { value: 'processing', weight: 5 },
] as const satisfies ReadonlyArray<{ value: RunStatus; weight: number }>

export function createMappingsWithTraffic({
  count,
  seed = 31,
  now = new Date(),
}: {
  count: number
  seed?: number
  now?: Date
}) {
  const faker = new Faker({ locale: [en], seed })
  const mappings = createMappingDrafts({ count, seed })

  const flows = createFlows({
    count: Math.round(count * 1.5),
    seed,
    mappings: mappings.flatMap((mapping) => {
      const versions = publishedVersionsOf(mapping)

      return versions.length > 0
        ? [{ mappingId: mapping.id, messageType: mapping.messageType, versions }]
        : []
    }),
  })

  const runs = flows.flatMap((flow) => {
    const tradingPartner = seedTradingPartners.find(({ id }) => id === flow.tradingPartnerId)!
    const healthy = faker.datatype.boolean({ probability: 0.6 })

    return Array.from({ length: faker.number.int({ min: 0, max: 12 }) }, () => {
      const status = healthy ? 'delivered' : faker.helpers.weightedArrayElement(trafficStatuses)

      return toRunSummary({
        id: faker.string.uuid(),
        status,
        failureStage: status === 'failed' ? 'validation' : null,
        receivedAt: faker.date.between({ from: now.getTime() - week, to: now }).toISOString(),
        tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
        messageType: flow.messageType,
        flow: { id: flow.id, name: flow.name },
        manualSubmission: false,
      })
    })
  })

  return { mappings, flows, runs }
}

export function structureOf(
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

const versionSpacing = 9 * day

// Seed Mappings keep the versions their Flows and Runs already pin.
export function publishedVersionsOf(
  draft: Pick<MappingDraftRecord, 'id' | 'name' | 'latestVersion' | 'updatedAt'>,
): MappingVersionSummary[] {
  const count = draft.latestVersion ?? 0
  const seeded = seedMappings.find(({ mappingId }) => mappingId === draft.id)?.versions

  if (seeded?.length === count) {
    return [...seeded]
  }

  const newest = Date.parse(draft.updatedAt) - versionSpacing

  return Array.from({ length: count }, (_, index) => {
    const version = count - index

    return mappingVersionSummarySchema.parse({
      id: stableUuid(`${draft.id}:version:${version}`),
      mappingId: draft.id,
      mappingName: draft.name,
      version,
      publishedAt: new Date(newest - index * versionSpacing).toISOString(),
    })
  })
}

export type PublishedVersions = {
  of: (mappingId: string) => ReadonlyArray<MappingVersionSummary>
  find: (versionId: string) => { version: MappingVersionSummary } | undefined
}

export function publishedVersionsByMapping(
  drafts: ReadonlyArray<MappingDraftRecord>,
): PublishedVersions {
  const byMapping = new Map(drafts.map((draft) => [draft.id, publishedVersionsOf(draft)]))

  const byId = new Map(
    [...byMapping.values()].flat().map((version) => [version.id, { version }] as const),
  )

  return { of: (mappingId) => byMapping.get(mappingId) ?? [], find: (id) => byId.get(id) }
}

type MappingTraffic = {
  flows: FlowStore
  runs: RunStore
  tradingPartners: TradingPartnerStore
  versions: PublishedVersions
}

type MappingCardFacts = Pick<
  MappingSummary,
  'partners' | 'documentsLast7Days' | 'failedRunsLast7Days'
>

const noTraffic: MappingCardFacts = { partners: [], documentsLast7Days: 0, failedRunsLast7Days: 0 }

function mappingCardFacts({
  flows,
  runs,
  tradingPartners,
  versions,
}: MappingTraffic): Map<string, MappingCardFacts> {
  const now = Date.now()
  const mappingOfFlow = new Map<string, string>()
  const facts = new Map<string, MappingCardFacts & { partners: TradingPartnerSummary[] }>()

  const factsOf = (mappingId: string) => {
    const existing = facts.get(mappingId)

    if (existing) {
      return existing
    }

    const created = { ...noTraffic, partners: [] }
    facts.set(mappingId, created)

    return created
  }

  for (const flow of flows.all()) {
    const mappingId = versions.find(flow.mappingVersionId)?.version.mappingId
    const tradingPartner = tradingPartners.get(flow.tradingPartnerId)

    if (!mappingId) {
      continue
    }

    mappingOfFlow.set(flow.id, mappingId)
    const { partners } = factsOf(mappingId)

    if (tradingPartner && !partners.some(({ id }) => id === tradingPartner.id)) {
      partners.push({ id: tradingPartner.id, name: tradingPartner.name })
    }
  }

  for (const run of runs.all()) {
    const mappingId = mappingOfFlow.get(run.flow.id)

    if (mappingId && Date.parse(run.receivedAt) >= now - week) {
      const counts = factsOf(mappingId)
      counts.documentsLast7Days += 1
      counts.failedRunsLast7Days += run.status === 'failed' ? 1 : 0
    }
  }

  for (const { partners } of facts.values()) {
    partners.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }

  return facts
}

function latestVersionPublishedAt(
  record: Pick<MappingDraftRecord, 'id' | 'latestVersion'>,
  versions: ReadonlyArray<MappingVersionSummary>,
) {
  if (record.latestVersion === null) {
    return null
  }

  const latest = versions.find(({ version }) => version === record.latestVersion)

  if (!latest) {
    throw new Error(`Mapping ${record.id} has no published version ${record.latestVersion}`)
  }

  return latest.publishedAt
}

export function toMappingSummary(
  record: MappingDraftRecord,
  documentStructures: DocumentStructures,
  { facts, versions }: { facts: MappingCardFacts; versions: ReadonlyArray<MappingVersionSummary> },
): MappingSummary {
  return mappingSummarySchema.parse({
    id: record.id,
    name: record.name,
    direction: directionOf(record),
    messageType: record.messageType,
    documentStructureId: record.documentStructureId,
    documentStructureName: structureOf(record, documentStructures).name,
    latestVersion: record.latestVersion,
    latestVersionPublishedAt: latestVersionPublishedAt(record, versions),
    unpublishedChanges: record.unpublishedChanges,
    draftUpdatedAt: record.updatedAt,
    ...facts,
  })
}

export function toMappingDraft(
  record: MappingDraftRecord,
  documentStructures: DocumentStructures,
): MappingDraft {
  return mappingDraftSchema.parse({
    mappingId: record.id,
    name: record.name,
    links: record.links,
    transforms: record.transforms,
    transformLinks: record.transformLinks,
    updatedAt: record.updatedAt,
    latestVersion: record.latestVersion,
    unpublishedChanges: record.unpublishedChanges,
    aiReview: record.aiReview ?? null,
    ...oriented(record.messageType, {
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

export function linkProblem(graph: MappingGraph, leaves: SideLeaves) {
  const message = unknownPathMessage(graph, leaves)

  return message === null ? null : unprocessable(message)
}

function unknownLookupTable({ transforms }: MappingGraph, lookupTables: LookupTableStore) {
  const unknown = transforms.find(
    (transform) =>
      transform.kind === 'lookupTable' &&
      transform.config.lookupTableId !== null &&
      !lookupTables.get(transform.config.lookupTableId),
  )

  return unknown?.kind === 'lookupTable'
    ? unprocessable(`The Workspace has no Lookup Table ${unknown.config.lookupTableId}.`)
    : null
}

function uniqueName(name: string, mappings: ReadonlyArray<MappingDraftRecord>) {
  const taken = new Set(mappings.map((mapping) => mapping.name))
  let count = 1

  while (taken.has(count === 1 ? name : `${name} ${count}`)) {
    count += 1
  }

  return count === 1 ? name : `${name} ${count}`
}

function newMappingDraft(
  messageType: MessageType,
  documentStructure: DocumentStructure,
  mappings: ReadonlyArray<MappingDraftRecord>,
): MappingDraftRecord {
  const { source, target } = oriented(messageType, {
    document: documentStructure.name,
    edifact: messageType,
  })

  return {
    id: crypto.randomUUID(),
    name: uniqueName(`${source} to ${target}`, mappings),
    messageType,
    documentStructureId: documentStructure.id,
    latestVersion: null,
    unpublishedChanges: true,
    links: [],
    transforms: [],
    transformLinks: [],
    updatedAt: new Date().toISOString(),
    aiReview: null,
  }
}

export type MappingsState = 'loading' | 'error'

export function mappingHandlers(
  apiUrl: string,
  {
    mappings = seedMappingDrafts,
    documentStructures = seedDocumentStructures,
    flows = seedFlows,
    runs,
    tradingPartners = seedTradingPartners,
    lookupTables = seedLookupTables,
    versions,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore | MappingsState
    documentStructures?: DocumentStructures | DocumentStructureStore
    flows?: ReadonlyArray<FlowRecord> | FlowStore
    runs?: ReadonlyArray<RunSummary> | RunStore
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore
    versions?: PublishedVersions
  } = {},
) {
  if (mappings === 'loading' || mappings === 'error') {
    const respond = async () => {
      if (mappings === 'loading') {
        await delay('infinite')
      }

      return serverError()
    }

    return [
      http.get(`${apiUrl}${mappingsEndpoint.path}`, respond),
      http.post(`${apiUrl}${createMappingEndpoint.path}`, respond),
    ]
  }

  const store = toMappingDraftStore(mappings)
  const structures = toDocumentStructureStore(documentStructures)
  const flowStore = toFlowStore(flows)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)
  const lookupTableStore = toLookupTableStore(lookupTables)
  let runStore: RunStore | undefined

  const summaries = () => {
    runStore ??= toRunStore(runs ?? seedRuns())
    const published = versions ?? publishedVersionsByMapping(store.all())

    const facts = mappingCardFacts({
      flows: flowStore,
      runs: runStore,
      tradingPartners: tradingPartnerStore,
      versions: published,
    })

    return store.all().map((record) =>
      toMappingSummary(record, structures.all(), {
        facts: facts.get(record.id) ?? noTraffic,
        versions: published.of(record.id),
      }),
    )
  }

  return [
    http.get(`${apiUrl}${mappingsEndpoint.path}`, () =>
      HttpResponse.json(summaries().sort((a, b) => a.name.localeCompare(b.name, 'de'))),
    ),
    http.post(`${apiUrl}${createMappingEndpoint.path}`, async ({ request }) => {
      const body = createMappingEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const { messageType, documentStructureId } = body.data

      // The Message Type isn't checked against the Document Structure yet.
      const documentStructure = structures.get(documentStructureId)

      if (!documentStructure) {
        return unprocessable('The Document Structure does not exist.')
      }

      const record = newMappingDraft(messageType, documentStructure, store.all())
      store.set(record)

      return HttpResponse.json(
        toMappingSummary(record, structures.all(), { facts: noTraffic, versions: [] }),
        { status: 201 },
      )
    }),
    http.get<{ id: string }>(`${apiUrl}${mappingDraftEndpoint.path}`, ({ params }) => {
      const record = store.get(params.id)

      return record ? HttpResponse.json(toMappingDraft(record, structures.all())) : notFound()
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

        const invalidLink = linkProblem(
          body.data,
          mappingSideLeaves(existing.messageType, structureOf(existing, structures.all())),
        )

        if (invalidLink) {
          return invalidLink
        }

        const invalidLookupTable = unknownLookupTable(body.data, lookupTableStore)

        if (invalidLookupTable) {
          return invalidLookupTable
        }

        const record = {
          ...existing,
          ...body.data,
          aiReview: existing.aiReview
            ? remainingAiReview(existing.aiReview, existing, body.data)
            : null,
          unpublishedChanges: true,
          updatedAt: new Date().toISOString(),
        }

        store.set(record)

        return HttpResponse.json(toMappingDraft(record, structures.all()))
      },
    ),
  ]
}
