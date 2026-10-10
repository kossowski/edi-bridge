import { en, Faker } from '@faker-js/faker'
import { delay, http, HttpResponse } from 'msw'

import {
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
  inferDocumentStructureEndpoint,
  type InferredDocumentStructure,
  type MessageType,
  messageTypes,
  type UpdateDocumentStructureBody,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'

import {
  adjustDocumentStructure,
  changesPaths,
  DocumentStructureProblemError,
  findNode,
  inferDocumentStructure,
} from './document-structure-inference'
import { documentStructureOrigins } from './document-structure-origin'
import { badRequest, notFound } from './responses'
import { seedId } from './seed-id'

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

function childPath(parentPath: string, name: string) {
  return parentPath === '' ? name : `${parentPath}.${name}`
}

function toNodes(specs: ReadonlyArray<Spec>, parentPath: string): DocumentStructureNode[] {
  return specs.map((spec) => {
    if (isField(spec)) {
      const [name, type, required = true] = spec

      return { kind: 'field', path: childPath(parentPath, name), name, type, required }
    }

    if ('object' in spec) {
      const path = childPath(parentPath, spec.object)

      return {
        kind: 'object',
        path,
        name: spec.object,
        required: spec.required ?? true,
        children: toNodes(spec.fields, path),
      }
    }

    const path = `${childPath(parentPath, spec.array)}[]`

    return {
      kind: 'array',
      path,
      name: spec.array,
      required: spec.required ?? true,
      items: {
        kind: 'object',
        path,
        name: spec.array,
        required: true,
        children: toNodes(spec.fields, path),
      },
    }
  })
}

function structure(index: number, name: string, specs: ReadonlyArray<Spec>): DocumentStructure {
  return documentStructureSchema.parse({
    id: seedId(6, index),
    name,
    format: 'json',
    children: toNodes(specs, ''),
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
  ORDERS: structure(1, 'ERP purchase order', [
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
  DESADV: structure(2, 'ERP dispatch advice', [
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
  INVOIC: structure(3, 'ERP invoice', [
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
  CONTRL: structure(4, 'ERP acknowledgement status', [
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

export const seedDocumentStructures: ReadonlyArray<DocumentStructure> = messageTypes.map(
  (messageType) => seedDocumentStructureOf[messageType],
)

export function documentStructureLeaves(
  documentStructure: Pick<DocumentStructure, 'children'>,
): DocumentField[] {
  const visit = (node: DocumentStructureNode): DocumentField[] => {
    switch (node.kind) {
      case 'field':
        return [node]
      case 'object':
        return node.children.flatMap(visit)
      case 'array':
        return visit(node.items)
    }
  }

  return documentStructure.children.flatMap(visit)
}

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
  const used = new Set<string>()

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

  const takeFields = (count: number): FieldSpec[] => {
    const taken = Math.min(count, remaining)
    remaining -= taken

    return Array.from({ length: taken }, () => [
      uniqueName(),
      faker.helpers.arrayElement(documentFieldTypes),
      faker.datatype.boolean({ probability: 0.6 }),
    ])
  }

  const specs: Spec[] = []

  for (let section = 0; remaining > 0; section++) {
    switch (section % 3) {
      case 0:
        specs.push(...takeFields(faker.number.int({ min: 2, max: 5 })))
        break
      case 1:
        specs.push({
          object: uniqueName(),
          fields: takeFields(faker.number.int({ min: 3, max: 8 })),
        })
        break
      default: {
        const fields: Spec[] = takeFields(faker.number.int({ min: 3, max: 8 }))
        const nested = takeFields(faker.number.int({ min: 2, max: 4 }))

        if (nested.length > 0) {
          fields.push({ array: uniqueName(), required: false, fields: nested })
        }

        specs.push({ array: uniqueName(), fields })
      }
    }
  }

  return documentStructureSchema.parse({
    id: faker.string.uuid(),
    name,
    format: 'json',
    children: toNodes(
      specs.filter((spec) => isField(spec) || spec.fields.length > 0),
      '',
    ),
  })
}

export function documentStructureHandler(
  apiUrl: string,
  documentStructures: ReadonlyArray<DocumentStructure> = seedDocumentStructures,
) {
  return http.get<{ id: string }>(`${apiUrl}${documentStructureEndpoint.path}`, ({ params }) => {
    const found = documentStructures.find(({ id }) => id === params.id)

    return found ? HttpResponse.json(found) : notFound()
  })
}

function named(id: string, name: string, inferred: InferredDocumentStructure): DocumentStructure {
  return documentStructureSchema.parse({ id, name, ...inferred })
}

// Structures no Mapping uses yet, created the way an Admin would: from a CSV export and a JSON
// Schema.
export const seedUnusedDocumentStructures: ReadonlyArray<DocumentStructure> = [
  named(
    seedId(6, 5),
    'ERP dispatch export (CSV)',
    inferDocumentStructure(documentStructureOrigins.windows1252CsvDocument),
  ),
  named(
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
  const csvSource = documentStructureOrigins.csvDocument

  return Array.from({ length: count }, (_, index) => {
    const name =
      `${faker.company.name()} ${faker.helpers.arrayElement(['export', 'import', 'feed'])}`.slice(
        0,
        70,
      )

    return index % 4 === 3
      ? named(faker.string.uuid(), name, inferDocumentStructure(csvSource))
      : createDocumentStructure({
          fieldCount: faker.number.int({ min: 5, max: 120 }),
          seed: seed + index,
          name,
        })
  })
}

export type DocumentStructureStore = {
  // Updated in place, so the Mapping handlers holding it see created and renamed structures.
  entries: ReadonlyArray<DocumentStructure>
  get: (id: string) => DocumentStructure | undefined
  set: (documentStructure: DocumentStructure) => void
}

export function createDocumentStructureStore(
  documentStructures: ReadonlyArray<DocumentStructure> = [
    ...seedDocumentStructures,
    ...seedUnusedDocumentStructures,
  ],
): DocumentStructureStore {
  const entries = [...documentStructures]

  return {
    entries,
    get: (id) => entries.find((entry) => entry.id === id),
    set: (documentStructure) => {
      const index = entries.findIndex(({ id }) => id === documentStructure.id)

      if (index === -1) {
        entries.push(documentStructure)
      } else {
        entries[index] = documentStructure
      }
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

type Usage = {
  mappings?: MappingDraftStore | undefined
  versions?: MappingVersionStore | undefined
}

export function toDocumentStructureSummary(
  documentStructure: DocumentStructure,
  { mappings }: Usage = {},
): DocumentStructureSummary {
  return documentStructureSummarySchema.parse({
    id: documentStructure.id,
    name: documentStructure.name,
    format: documentStructure.format,
    fieldCount: documentStructureLeaves(documentStructure).length,
    mappings: (mappings?.all() ?? [])
      .filter(({ documentStructureId }) => documentStructureId === documentStructure.id)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  })
}

function linkedPaths(documentStructureId: string, { mappings, versions }: Usage) {
  return (mappings?.all() ?? [])
    .filter((mapping) => mapping.documentStructureId === documentStructureId)
    .flatMap((mapping) => [mapping, ...(versions?.of(mapping.id) ?? [])])
    .flatMap(({ links, transformLinks }) => [
      ...links.flatMap(({ sourcePath, targetPath }) => [sourcePath, targetPath]),
      ...transformLinks.flatMap(({ from, to }) => [
        ...(from.kind === 'source' ? [from.path] : []),
        ...(to.kind === 'target' ? [to.path] : []),
      ]),
    ])
}

function isWithin(path: string, nodePath: string) {
  return path === nodePath || path.startsWith(`${nodePath}.`) || path.startsWith(`${nodePath}[]`)
}

// Turning a node into a list or back renames the paths below it, which would cut the links of
// every Mapping Version that uses them.
function linkedChange(
  documentStructure: DocumentStructure,
  body: UpdateDocumentStructureBody,
  usage: Usage,
) {
  const linked = linkedPaths(documentStructure.id, usage)

  return body.adjustments
    .filter((adjustment) => changesPaths(documentStructure, adjustment))
    .find(({ path }) => {
      const nodePath = findNode(documentStructure.children, path)!.path

      return linked.some((linkedPath) => isWithin(linkedPath, nodePath))
    })
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

export function documentStructureHandlers(
  apiUrl: string,
  {
    documentStructures = createDocumentStructureStore(),
    mappings,
    versions,
  }: {
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
  } & Usage = {},
) {
  const store = toDocumentStructureStore(documentStructures)
  const usage = { mappings, versions }

  return [
    http.get(`${apiUrl}${documentStructuresEndpoint.path}`, async () => {
      await delay()

      return HttpResponse.json(
        store.entries
          .map((entry) => toDocumentStructureSummary(entry, usage))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      )
    }),
    http.post(`${apiUrl}${inferDocumentStructureEndpoint.path}`, async ({ request }) => {
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

      const inferred = attempt(() => inferDocumentStructure(body.data.origin))

      if ('response' in inferred) {
        return inferred.response
      }

      const created = named(crypto.randomUUID(), body.data.name, inferred.result)
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

        const adjusted = attempt(() => adjustDocumentStructure(existing, body.data))

        if ('response' in adjusted) {
          return adjusted.response
        }

        const linked = linkedChange(existing, body.data, usage)

        if (linked) {
          return problemResponse({
            code: 'linkedByMapping',
            message: `A Mapping links fields at or below ${linked.path}, so it cannot turn into a list or back`,
            path: linked.path,
            line: null,
          })
        }

        const updated = documentStructureSchema.parse(adjusted.result)
        store.set(updated)

        return HttpResponse.json(updated)
      },
    ),
  ]
}
