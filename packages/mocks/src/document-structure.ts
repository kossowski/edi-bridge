import { en, Faker } from '@faker-js/faker'
import { delay, http, HttpResponse } from 'msw'

import {
  arrayPath,
  childPath,
  createDocumentStructureEndpoint,
  type DocumentField,
  type DocumentFieldType,
  documentFieldTypes,
  type DocumentStructure,
  documentStructureEndpoint,
  type DocumentStructureNode,
  type DocumentStructureProblem,
  documentStructureSchema,
  documentStructuresEndpoint,
  type DocumentStructureSummary,
  documentStructureSummarySchema,
  samplePreview,
  type GraphParts,
  inferDocumentStructureEndpoint,
  type InferredDocumentStructure,
  type JsonContent,
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type MessageType,
  messageTypes,
  summaryFieldLabelCount,
  type UpdateDocumentStructureBody,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'

import {
  adjustDocumentStructure,
  applyLabels,
  documentStructureLeaves,
  DocumentStructureProblemError,
  findNode,
  inferDocumentStructure,
  sameCsvSettings,
  visitedNode,
} from './document-structure-inference'
import { documentStructureOrigins } from './document-structure-origin'
import { knownFieldNames, plainNameOf } from './field-label'
import { byNameAndNewest } from './flow'
import { containerOf } from './paths'
import { badRequest, notFound, serverError } from './responses'
import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'

import type { MappingDraftStore } from './mapping'
import type { MappingVersionStore } from './mapping-version'

type FieldSpec = readonly [name: string, type: DocumentFieldType, required?: boolean]

type Spec =
  | FieldSpec
  | { object: string; required?: boolean; fields: ReadonlyArray<Spec> }
  | { array: string; required?: boolean; fields: ReadonlyArray<Spec> }

function isField(spec: Spec): spec is FieldSpec {
  return Array.isArray(spec)
}

function toNodes(specs: ReadonlyArray<Spec>, parentPath: string): DocumentStructureNode[] {
  return specs.map((spec) => {
    if (isField(spec)) {
      const [name, type, required = true] = spec

      return {
        kind: 'field',
        path: childPath(parentPath, name),
        name,
        ...plainNameOf(name),
        type,
        required,
      }
    }

    if ('object' in spec) {
      const path = childPath(parentPath, spec.object)

      return {
        kind: 'object',
        path,
        name: spec.object,
        ...plainNameOf(spec.object),
        required: spec.required ?? true,
        children: toNodes(spec.fields, path),
      }
    }

    const path = arrayPath(childPath(parentPath, spec.array))
    const named = { path, name: spec.array, ...plainNameOf(spec.array) }

    return {
      kind: 'array',
      ...named,
      required: spec.required ?? true,
      items: { kind: 'object', ...named, required: true, children: toNodes(spec.fields, path) },
    }
  })
}

const sampleTexts = new Map<string, ReadonlyArray<string>>([
  ['gln', ['4012345000016', '4098765000013', '4012345000023']],
  ['gtin', ['04012345123456', '04012345654321', '04012345777777']],
  ['sscc', ['340123450000000017', '340123450000000024']],
  ['currency', ['EUR']],
  ['country', ['DE']],
  ['city', ['Lübeck', 'Hamburg', 'Bremen']],
  ['name', ['Hansemarkt GmbH', 'Nordfrost Logistik GmbH', 'Alpenfrisch Märkte AG']],
  ['unit', ['PCE', 'KGM']],
  ['street', ['Hafenstraße 12', 'Industrieweg 4', 'Am Markt 1']],
  ['postalCode', ['23552', '20457', '28195']],
  ['description', ['Haferdrink Bio 1 l', 'Dinkeldrink 1 l', 'Haferdrink Barista 1 l']],
  ['note', ['Rampe 2', 'Kühlware']],
  ['email', ['einkauf@hansemarkt.example']],
  ['phone', ['+49 451 123456']],
  ['status', ['accepted']],
])

// Every array gets two items, so the sample shows that the list repeats.
function sampleOf(
  nodes: ReadonlyArray<DocumentStructureNode>,
  faker: Faker,
): Record<string, JsonContent> {
  const valueOf = (node: DocumentField | DocumentStructureNode): JsonContent => {
    switch (node.kind) {
      case 'object':
        return sampleOf(node.children, faker)
      case 'array':
        return [valueOf(node.items), valueOf(node.items)]
      default:
        return fieldValue(node, faker)
    }
  }

  return Object.fromEntries(nodes.map((node) => [node.name, valueOf(node)]))
}

function fieldValue(field: DocumentField, faker: Faker): JsonContent {
  const known = sampleTexts.get(field.name)

  if (known) {
    return faker.helpers.arrayElement(known)
  }

  switch (field.type) {
    case 'number':
      return faker.number.float({ min: 1, max: 500, fractionDigits: 2 })
    case 'integer':
      return faker.number.int({ min: 1, max: 48 })
    case 'boolean':
      return faker.datatype.boolean()
    case 'date':
      return `2026-10-${String(faker.number.int({ min: 1, max: 28 })).padStart(2, '0')}`
    default:
      return `${faker.string.alpha({ length: 2, casing: 'upper' })}-${faker.string.numeric(5)}`
  }
}

function jsonSample(
  fileName: string,
  children: ReadonlyArray<DocumentStructureNode>,
  takenAt: string,
) {
  return {
    fileName,
    text: JSON.stringify(sampleOf(children, seededFaker(`sample:${fileName}`)), null, 2),
    takenAt,
  }
}

function structure(
  index: number,
  name: string,
  fileName: string,
  specs: ReadonlyArray<Spec>,
): DocumentStructure {
  const children = toNodes(specs, '')

  return documentStructureSchema.parse({
    id: seedId(6, index),
    name,
    format: 'json',
    root: 'object',
    sample: jsonSample(fileName, children, `2026-09-${String(10 + index)}T10:00:00.000Z`),
    children,
  })
}

const address: ReadonlyArray<Spec> = [
  ['gln', 'string'],
  ['name', 'string', false],
  ['street', 'string', false],
  ['postalCode', 'string', false],
  ['city', 'string', false],
  ['country', 'string', false],
]

const party = (name: string, required = true, extra: ReadonlyArray<Spec> = []): Spec => ({
  object: name,
  required,
  fields: [...address, ...extra],
})

const vatId: FieldSpec = ['vatId', 'string', false]

export const seedDocumentStructureOf: Readonly<Record<MessageType, DocumentStructure>> = {
  ORDERS: structure(1, 'ERP purchase order', 'order-4711.json', [
    ['orderNumber', 'string'],
    ['orderDate', 'date'],
    ['requestedDeliveryDate', 'date', false],
    ['contractNumber', 'string', false],
    ['currency', 'string', false],
    ['note', 'string', false],
    party('buyer', true, [
      vatId,
      {
        object: 'contact',
        required: false,
        fields: [
          ['name', 'string'],
          ['phone', 'string', false],
          ['email', 'string', false],
        ],
      },
    ]),
    party('supplier', true, [vatId]),
    party('deliveryParty', false),
    party('invoicee', false),
    {
      array: 'lines',
      fields: [
        ['lineNumber', 'integer'],
        ['gtin', 'string'],
        ['supplierArticleNumber', 'string', false],
        ['buyerArticleNumber', 'string', false],
        ['description', 'string', false],
        ['quantity', 'number'],
        ['unit', 'string', false],
        ['netPrice', 'number', false],
        ['requestedDeliveryDate', 'date', false],
      ],
    },
    ['lineCount', 'integer', false],
  ]),
  DESADV: structure(2, 'ERP dispatch advice', 'dispatch-4715.json', [
    ['despatchNumber', 'string'],
    ['despatchDate', 'date'],
    ['documentDate', 'date'],
    ['estimatedDeliveryDate', 'date', false],
    ['orderNumber', 'string'],
    party('buyer'),
    party('supplier'),
    party('shipTo'),
    {
      array: 'packages',
      fields: [
        ['packageNumber', 'integer'],
        ['parentPackageNumber', 'integer', false],
        ['packageType', 'string'],
        ['sscc', 'string'],
        {
          array: 'lines',
          fields: [
            ['lineNumber', 'integer'],
            ['gtin', 'string'],
            ['supplierArticleNumber', 'string', false],
            ['description', 'string', false],
            ['quantity', 'number'],
          ],
        },
      ],
    },
  ]),
  INVOIC: structure(3, 'ERP invoice', 'invoice-r-2026-1188.json', [
    ['invoiceNumber', 'string'],
    ['invoiceDate', 'date'],
    ['isCreditNote', 'boolean'],
    ['deliveryDate', 'date', false],
    ['orderNumber', 'string', false],
    ['deliveryNoteNumber', 'string', false],
    ['currency', 'string'],
    ['paymentDueDate', 'date', false],
    party('buyer', true, [vatId]),
    party('supplier', true, [vatId]),
    party('invoicee', false),
    party('shipTo', false),
    {
      array: 'lines',
      fields: [
        ['lineNumber', 'integer'],
        ['gtin', 'string'],
        ['supplierArticleNumber', 'string', false],
        ['description', 'string', false],
        ['quantity', 'number'],
        ['netPrice', 'number'],
        ['lineAmount', 'number'],
        ['vatRate', 'number'],
      ],
    },
    {
      object: 'totals',
      fields: [
        ['lineTotal', 'number'],
        ['taxableAmount', 'number'],
        ['vatAmount', 'number'],
        ['invoiceTotal', 'number'],
      ],
    },
    {
      array: 'vatBreakdown',
      fields: [
        ['rate', 'number'],
        ['amount', 'number'],
      ],
    },
  ]),
  CONTRL: structure(4, 'ERP acknowledgement status', 'acknowledgement-0815.json', [
    ['interchangeReference', 'string'],
    ['senderGln', 'string'],
    ['recipientGln', 'string'],
    ['status', 'string'],
    ['syntaxError', 'string', false],
    {
      array: 'messages',
      required: false,
      fields: [
        ['messageReference', 'string'],
        ['messageType', 'string'],
        ['status', 'string'],
        ['syntaxError', 'string', false],
        {
          array: 'segmentErrors',
          required: false,
          fields: [
            ['position', 'integer'],
            ['syntaxError', 'string', false],
          ],
        },
      ],
    },
  ]),
}

export const seedInvoiceExportDocumentStructure = toDocumentStructure(
  seedId(6, 7),
  'ERP invoice export (CSV)',
  inferDocumentStructure(documentStructureOrigins.invoiceCsvDocument, {
    takenAt: '2026-10-08T16:30:00.000Z',
  }),
)

export const seedDocumentStructures: ReadonlyArray<DocumentStructure> = [
  ...messageTypes.map((messageType) => seedDocumentStructureOf[messageType]),
  seedInvoiceExportDocumentStructure,
]

// Spreads the fields over plain fields, objects and arrays of objects with a nested array, so a
// large structure still shows every kind of nesting.
export function createDocumentStructure({
  fieldCount,
  seed = 23,
  name = 'ERP master data export',
}: {
  fieldCount: number
  seed?: number
  name?: string
}): DocumentStructure {
  const faker = new Faker({ locale: [en], seed })
  const used = new Set<string>(knownFieldNames)

  const uniqueName = () => {
    const base =
      faker.word
        .noun()
        .replaceAll(/[^A-Za-z]/g, '')
        .toLowerCase() || 'field'

    let candidate = base

    for (let suffix = 2; used.has(candidate); suffix++) {
      candidate = `${base}${suffix}`
    }

    used.add(candidate)

    return candidate
  }

  let remaining = fieldCount

  const fieldName = (siblings: Set<string>) => {
    const free = knownFieldNames.filter((known) => !siblings.has(known))

    const chosen =
      free.length === 0 || faker.datatype.boolean({ probability: 0.05 })
        ? uniqueName()
        : faker.helpers.arrayElement(free)

    siblings.add(chosen)

    return chosen
  }

  const takeFields = (count: number): FieldSpec[] => {
    const taken = Math.min(count, remaining)
    const siblings = new Set<string>()
    remaining -= taken

    return Array.from({ length: taken }, () => [
      fieldName(siblings),
      faker.helpers.arrayElement(documentFieldTypes),
      faker.datatype.boolean({ probability: 0.6 }),
    ])
  }

  const specs: Spec[] = takeFields(faker.number.int({ min: 2, max: 5 }))

  for (let section = 0; remaining > 0; section++) {
    if (section % 2 === 0) {
      specs.push({ object: uniqueName(), fields: takeFields(faker.number.int({ min: 3, max: 8 })) })
    } else {
      const fields: Spec[] = takeFields(faker.number.int({ min: 3, max: 8 }))
      const nested = takeFields(faker.number.int({ min: 2, max: 4 }))

      if (nested.length > 0) {
        fields.push({ array: uniqueName(), required: false, fields: nested })
      }

      specs.push({ array: uniqueName(), fields })
    }
  }

  const children = toNodes(
    specs.filter((spec) => isField(spec) || spec.fields.length > 0),
    '',
  )

  return documentStructureSchema.parse({
    id: faker.string.uuid(),
    name,
    format: 'json',
    root: 'object',
    sample: jsonSample(`export-${seed}.json`, children, '2026-09-20T10:00:00.000Z'),
    children,
  })
}

function toDocumentStructure(
  id: string,
  name: string,
  inferred: InferredDocumentStructure,
): DocumentStructure {
  return documentStructureSchema.parse({ id, name, ...inferred })
}

export const seedUnusedDocumentStructures: ReadonlyArray<DocumentStructure> = [
  toDocumentStructure(
    seedId(6, 5),
    'ERP dispatch export (CSV)',
    inferDocumentStructure(documentStructureOrigins.windows1252CsvDocument, {
      takenAt: '2026-09-18T10:00:00.000Z',
    }),
  ),
  toDocumentStructure(
    seedId(6, 6),
    'ERP article master',
    inferDocumentStructure(documentStructureOrigins.jsonSchema),
  ),
]

export function createDocumentStructures({
  count,
  seed = 29,
}: {
  count: number
  seed?: number
}): DocumentStructure[] {
  const faker = new Faker({ locale: [en], seed })
  const csvOrigin = documentStructureOrigins.csvDocument

  return Array.from({ length: count }, (_, index) => {
    const name =
      `${faker.company.name()} ${faker.helpers.arrayElement(['export', 'import', 'feed'])}`.slice(
        0,
        70,
      )

    return index % 4 === 3
      ? toDocumentStructure(
          faker.string.uuid(),
          name,
          inferDocumentStructure(csvOrigin, { takenAt: '2026-09-25T10:00:00.000Z' }),
        )
      : createDocumentStructure({
          fieldCount: faker.number.int({ min: 5, max: 120 }),
          seed: seed + index,
          name,
        })
  })
}

export type DocumentStructureStore = {
  all: () => readonly DocumentStructure[]
  get: (id: string) => DocumentStructure | undefined
  set: (documentStructure: DocumentStructure) => void
}

export function createDocumentStructureStore(
  documentStructures: ReadonlyArray<DocumentStructure> = [
    ...seedDocumentStructures,
    ...seedUnusedDocumentStructures,
  ],
): DocumentStructureStore {
  const byId = new Map(documentStructures.map((structure) => [structure.id, structure]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (documentStructure) => {
      byId.set(documentStructure.id, documentStructure)
    },
  }
}

export function toDocumentStructureStore(
  documentStructures: ReadonlyArray<DocumentStructure> | DocumentStructureStore,
) {
  return 'get' in documentStructures
    ? documentStructures
    : createDocumentStructureStore(documentStructures)
}

type MappingUse = {
  mappings?: MappingDraftStore | undefined
  versions?: MappingVersionStore | undefined
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, 'de')
}

function toDocumentStructureSummary(
  documentStructure: DocumentStructure,
  { mappings }: MappingUse = {},
): DocumentStructureSummary {
  const leaves = documentStructureLeaves(documentStructure)
  const { sample } = documentStructure

  return documentStructureSummarySchema.parse({
    id: documentStructure.id,
    name: documentStructure.name,
    format: documentStructure.format,
    fieldCount: leaves.length,
    firstFieldLabels: leaves.slice(0, summaryFieldLabelCount).map(({ label }) => label),
    sample: sample && {
      fileName: sample.fileName,
      takenAt: sample.takenAt,
      preview: samplePreview(sample.text),
    },
    mappings: (mappings?.all() ?? [])
      .filter(({ documentStructureId }) => documentStructureId === documentStructure.id)
      .map(({ id, name }) => ({ id, name }))
      .sort(byName),
  })
}

function linkedPaths({ links, transformLinks }: GraphParts) {
  return [
    ...links.flatMap(({ sourcePath, targetPath }) => [sourcePath, targetPath]),
    ...transformLinks.flatMap(({ from, to }) => [
      ...(from.kind === 'source' ? [from.path] : []),
      ...(to.kind === 'target' ? [to.path] : []),
    ]),
  ]
}

function publishedUses(documentStructureId: string, { versions }: MappingUse) {
  return (versions?.all() ?? []).filter(
    (version) => version.documentStructureId === documentStructureId,
  )
}

function summaries(versions: ReadonlyArray<MappingVersionSummary>) {
  return versions.map((version) => mappingVersionSummarySchema.parse(version)).sort(byNameAndNewest)
}

// Plain names only label a node, so a rename changes no shape a Mapping relies on.
const linkedNodeKeys = ['path', 'name', 'kind', 'required', 'type', 'children', 'items']

function fingerprintAt(nodes: ReadonlyArray<DocumentStructureNode>, path: string) {
  const visited = visitedNode(nodes, path)

  return (
    visited &&
    JSON.stringify(
      [
        ...visited.ancestors.map(({ path: ancestorPath, kind, required }) => ({
          path: ancestorPath,
          kind,
          required,
        })),
        visited.node,
      ],
      linkedNodeKeys,
    )
  )
}

function related(a: string, b: string) {
  return a === b || containerOf([a], b) || containerOf([b], a)
}

function adjustmentAt(linkedPath: string, body: UpdateDocumentStructureBody) {
  return body.adjustments.find(({ path }) => related(path, linkedPath))?.path ?? linkedPath
}

function usedByMappingVersion(
  versions: ReadonlyArray<MappingVersionSummary>,
  message: string,
  path: string | null,
): DocumentStructureProblem {
  const versionNames = versions.map(({ mappingName, version }) => `${mappingName} v${version}`)

  return {
    code: 'usedByMappingVersion',
    message: `${message}: ${versionNames.join(', ')}`,
    path,
    line: null,
    mappingVersions: [...versions],
  }
}

function settingsChange(
  existing: DocumentStructure,
  body: UpdateDocumentStructureBody,
  use: MappingUse,
): DocumentStructureProblem | null {
  const published = publishedUses(existing.id, use)

  if (
    existing.format !== 'csv' ||
    body.csv === undefined ||
    sameCsvSettings(existing.csv, body.csv) ||
    published.length === 0
  ) {
    return null
  }

  return usedByMappingVersion(
    summaries(published),
    'Published Mapping Versions read this Document Structure with its CSV settings',
    null,
  )
}

// Published Mapping Versions never change, so nothing they link may change shape. A Draft only
// needs its links to keep pointing at a node.
function linkChange(
  existing: DocumentStructure,
  updated: DocumentStructure,
  body: UpdateDocumentStructureBody,
  use: MappingUse,
): DocumentStructureProblem | null {
  const known = (path: string) => findNode(existing.children, path) !== undefined

  const changed = (path: string) =>
    known(path) && fingerprintAt(existing.children, path) !== fingerprintAt(updated.children, path)

  const published = publishedUses(existing.id, use).filter((version) =>
    linkedPaths(version).some(changed),
  )

  const [firstPublished] = published

  if (firstPublished) {
    const path = adjustmentAt(linkedPaths(firstPublished).find(changed)!, body)

    return usedByMappingVersion(
      summaries(published),
      `Published Mapping Versions use ${path}, and a published Mapping Version never changes`,
      path,
    )
  }

  const broken = (use.mappings?.all() ?? [])
    .filter(({ documentStructureId }) => documentStructureId === existing.id)
    .flatMap(linkedPaths)
    .find((path) => known(path) && findNode(updated.children, path) === undefined)

  if (broken === undefined) {
    return null
  }

  const path = adjustmentAt(broken, body)

  return {
    code: 'linkedByMapping',
    message: `A Mapping Draft links ${broken}, which the change at ${path} would remove`,
    path,
    line: null,
    mappingVersions: null,
  }
}

function problemResponse(problem: DocumentStructureProblem) {
  return HttpResponse.json(problem, { status: 422 })
}

function attempt<Result>(run: () => Result): { result: Result } | { response: Response } {
  try {
    return { result: run() }
  } catch (error) {
    if (error instanceof DocumentStructureProblemError) {
      return { response: problemResponse(error.problem) }
    }

    throw error
  }
}

export type DocumentStructuresState = 'loading' | 'error'

async function respondIn(state: DocumentStructuresState) {
  if (state === 'loading') {
    await delay('infinite')
  }

  return serverError()
}

export function documentStructureHandlers(
  apiUrl: string,
  {
    documentStructures = createDocumentStructureStore(),
    mappings,
    versions,
    state,
    inferenceState,
  }: {
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
    state?: DocumentStructuresState | undefined
    inferenceState?: DocumentStructuresState | undefined
  } & MappingUse = {},
) {
  if (state) {
    const respond = () => respondIn(state)

    return [
      http.get(`${apiUrl}${documentStructuresEndpoint.path}`, respond),
      http.post(`${apiUrl}${inferDocumentStructureEndpoint.path}`, respond),
      http.post(`${apiUrl}${createDocumentStructureEndpoint.path}`, respond),
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, respond),
      http.put(`${apiUrl}${updateDocumentStructureEndpoint.path}`, respond),
    ]
  }

  const store = toDocumentStructureStore(documentStructures)
  const use = { mappings, versions }

  return [
    http.get(`${apiUrl}${documentStructuresEndpoint.path}`, async () => {
      await delay()

      return HttpResponse.json(
        store
          .all()
          .map((entry) => toDocumentStructureSummary(entry, use))
          .sort(byName),
      )
    }),
    http.post(`${apiUrl}${inferDocumentStructureEndpoint.path}`, async ({ request }) => {
      if (inferenceState) {
        return respondIn(inferenceState)
      }

      const body = inferDocumentStructureEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      await delay()

      const inferred = attempt(() => inferDocumentStructure(body.data))

      return 'response' in inferred ? inferred.response : HttpResponse.json(inferred.result)
    }),
    http.post(`${apiUrl}${createDocumentStructureEndpoint.path}`, async ({ request }) => {
      const body = createDocumentStructureEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      await delay()

      const { origin, labels = [] } = body.data
      const inferred = attempt(() => applyLabels(inferDocumentStructure(origin), labels))

      if ('response' in inferred) {
        return inferred.response
      }

      const created = toDocumentStructure(crypto.randomUUID(), body.data.name, inferred.result)
      store.set(created)

      return HttpResponse.json(created, { status: 201 })
    }),
    http.get<{ id: string }>(`${apiUrl}${documentStructureEndpoint.path}`, ({ params }) => {
      const found = store.get(params.id)

      return found ? HttpResponse.json(found) : notFound()
    }),
    http.put<{ id: string }>(
      `${apiUrl}${updateDocumentStructureEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        const body = updateDocumentStructureEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        await delay()

        const refusedSettings = settingsChange(existing, body.data, use)

        if (refusedSettings) {
          return problemResponse(refusedSettings)
        }

        const adjusted = attempt(() => adjustDocumentStructure(existing, body.data))

        if ('response' in adjusted) {
          return adjusted.response
        }

        const updated = documentStructureSchema.parse(adjusted.result)
        const refusedLinks = linkChange(existing, updated, body.data, use)

        if (refusedLinks) {
          return problemResponse(refusedLinks)
        }

        store.set(updated)

        return HttpResponse.json(updated)
      },
    ),
  ]
}
