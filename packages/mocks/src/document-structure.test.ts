import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type CreateDocumentStructureBody,
  createDocumentStructureEndpoint,
  type DocumentStructure,
  documentStructureEndpoint,
  type DocumentStructureNode,
  documentStructureProblemSchema,
  documentStructuresEndpoint,
  type DocumentStructureOrigin,
  inferDocumentStructureEndpoint,
  toPath,
  type UpdateDocumentStructureBody,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  createDocumentStructures,
  createDocumentStructureStore,
  documentStructureHandlers,
  documentStructureLeaves,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
} from './document-structure'
import { documentStructureOrigins, toEncodedFile } from './document-structure-origin'
import { createMappingDraftStore, seedMappingDrafts } from './mapping'
import {
  createMappingVersionStore,
  type MappingVersionRecord,
  seedMappingVersions,
} from './mapping-version'
import { seedSession } from './session'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getStructure(id: string) {
  return fetch(`${apiUrl}${toPath(documentStructureEndpoint.path, { id })}`)
}

function childrenOf(node: DocumentStructureNode): DocumentStructureNode[] {
  switch (node.kind) {
    case 'field':
      return []
    case 'object':
      return node.children
    case 'array':
      return [node.items]
  }
}

function nodeAt(
  nodes: ReadonlyArray<DocumentStructureNode>,
  path: string,
): DocumentStructureNode | undefined {
  for (const node of nodes) {
    const found = node.path === path ? node : nodeAt(childrenOf(node), path)

    if (found) {
      return found
    }
  }

  return undefined
}

const purchaseOrder = seedDocumentStructures.find(({ name }) => name === 'ERP purchase order')!

describe('GET /document-structures/:id', () => {
  it('serves a seed structure with nested objects and repeating line items', async () => {
    server.use(...documentStructureHandlers(apiUrl))

    const response = await getStructure(purchaseOrder.id)
    const structure = documentStructureEndpoint.response.parse(await response.json())

    expect(nodeAt(structure.children, 'buyer.gln')).toMatchObject({ kind: 'field', type: 'string' })
    expect(nodeAt(structure.children, 'lines[]')).toMatchObject({ kind: 'array', required: true })
    expect(nodeAt(structure.children, 'lines[].quantity')).toMatchObject({ type: 'number' })
  })

  it('answers 404 for an unknown structure', async () => {
    server.use(...documentStructureHandlers(apiUrl))

    expect((await getStructure(crypto.randomUUID())).status).toBe(404)
  })

  it('serves a large generated structure', async () => {
    const large = createDocumentStructure({ fieldCount: 400 })
    server.use(...documentStructureHandlers(apiUrl, { documentStructures: [large] }))

    const response = await getStructure(large.id)
    const structure = documentStructureEndpoint.response.parse(await response.json())

    expect(documentStructureLeaves(structure)).toHaveLength(400)
  })
})

describe('createDocumentStructure', () => {
  const structure = createDocumentStructure({ fieldCount: 120 })

  it('nests objects and repeating arrays', () => {
    const kinds = new Set<string>()

    const visit = (nodes: ReadonlyArray<DocumentStructureNode>, depth: number) => {
      for (const node of nodes) {
        kinds.add(`${node.kind}@${Math.min(depth, 2)}`)
        visit(childrenOf(node), depth + 1)
      }
    }

    visit(structure.children, 0)

    expect(kinds).toContain('array@0')
    expect(kinds).toContain('object@0')
    expect(kinds).toContain('field@2')
  })

  it('gives every field a unique path', () => {
    const paths = documentStructureLeaves(structure).map(({ path }) => path)

    expect(new Set(paths).size).toBe(paths.length)
  })

  it('generates the same structure for the same seed', () => {
    expect(createDocumentStructure({ fieldCount: 30 })).toEqual(
      createDocumentStructure({ fieldCount: 30 }),
    )
  })
})

describe('seed Document Structures', () => {
  it.each(seedDocumentStructures.map((structure) => [structure.name, structure] as const))(
    '%s has unique field paths',
    (_, structure: DocumentStructure) => {
      const paths = documentStructureLeaves(structure).map(({ path }) => path)

      expect(paths.length).toBeGreaterThan(5)
      expect(new Set(paths).size).toBe(paths.length)
    },
  )
})

function post(path: string, body: CreateDocumentStructureBody | DocumentStructureOrigin) {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function put(id: string, body: UpdateDocumentStructureBody) {
  return fetch(`${apiUrl}${toPath(updateDocumentStructureEndpoint.path, { id })}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function useHandlers({
  documentStructures,
  versions = seedMappingVersions,
}: {
  documentStructures?: ReadonlyArray<DocumentStructure>
  versions?: ReadonlyArray<MappingVersionRecord>
} = {}) {
  const store = createDocumentStructureStore(documentStructures)
  const mappings = createMappingDraftStore(seedMappingDrafts)

  server.use(
    ...documentStructureHandlers(apiUrl, {
      documentStructures: store,
      mappings,
      versions: createMappingVersionStore(versions),
    }),
  )

  return store
}

async function problemOf(response: Response) {
  expect(response.status).toBe(422)

  return documentStructureProblemSchema.parse(await response.json())
}

describe('GET /document-structures', () => {
  it('lists the structures by name with the Mappings that use them', async () => {
    useHandlers()

    const response = await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)
    const summaries = documentStructuresEndpoint.response.parse(await response.json())
    const names = summaries.map(({ name }) => name)

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')))
    const used = summaries.find(({ id }) => id === purchaseOrder.id)

    expect(used).toMatchObject({
      format: 'json',
      fieldCount: documentStructureLeaves(purchaseOrder).length,
    })
    expect(used?.mappings.map(({ id }) => id)).toEqual(
      expect.arrayContaining(
        seedMappingDrafts
          .filter(({ documentStructureId }) => documentStructureId === purchaseOrder.id)
          .map(({ id }) => id),
      ),
    )
    expect(used?.mappings).not.toEqual([])
    expect(summaries.find(({ id }) => id === seedUnusedDocumentStructures[0]!.id)).toMatchObject({
      format: 'csv',
      mappings: [],
    })
  })

  it('serves an empty list', async () => {
    useHandlers({ documentStructures: [] })

    const response = await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)

    expect(await response.json()).toEqual([])
  })

  it('serves a large list', async () => {
    useHandlers({ documentStructures: createDocumentStructures({ count: 300 }) })

    const response = await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)
    const summaries = documentStructuresEndpoint.response.parse(await response.json())

    expect(summaries).toHaveLength(300)
    expect(new Set(summaries.map(({ format }) => format))).toEqual(new Set(['json', 'csv']))
  })
})

describe('POST /document-structures/inference', () => {
  it('infers a structure without storing it', async () => {
    const store = useHandlers()
    const count = store.all().length

    const response = await post(
      inferDocumentStructureEndpoint.path,
      documentStructureOrigins.windows1252CsvDocument,
    )

    const inferred = inferDocumentStructureEndpoint.response.parse(await response.json())

    expect(inferred).toMatchObject({ format: 'csv', csv: { encoding: 'windows-1252' } })
    expect(JSON.stringify(inferred)).toContain('Straße')
    expect(store.all()).toHaveLength(count)
  })

  it('answers 400 for a body outside the contract', async () => {
    useHandlers()

    const response = await fetch(`${apiUrl}${inferDocumentStructureEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'xmlDocument' }),
    })

    expect(response.status).toBe(400)
  })
})

describe('POST /document-structures', () => {
  async function create(origin: DocumentStructureOrigin, name = 'ERP export') {
    const body: CreateDocumentStructureBody = { name, origin }

    return post(createDocumentStructureEndpoint.path, body)
  }

  it('creates a structure from a JSON Document and serves it afterwards', async () => {
    useHandlers()

    const response = await create(documentStructureOrigins.jsonDocument, 'ERP order')

    expect(response.status).toBe(201)

    const created = createDocumentStructureEndpoint.response.parse(await response.json())
    const served = await getStructure(created.id)

    expect(created).toMatchObject({ name: 'ERP order', format: 'json' })
    expect(await served.json()).toEqual(created)
  })

  it('creates a structure from a JSON Schema', async () => {
    useHandlers()

    const response = await create(documentStructureOrigins.jsonSchema)
    const created = createDocumentStructureEndpoint.response.parse(await response.json())

    expect(nodeAt(created.children, 'prices[].amount')).toMatchObject({ type: 'number' })
  })

  it('reads a Windows-1252 CSV Document with umlauts', async () => {
    useHandlers()

    const response = await create(documentStructureOrigins.windows1252CsvDocument)
    const created = createDocumentStructureEndpoint.response.parse(await response.json())

    expect(nodeAt(created.children, 'rows[].Straße')).toMatchObject({ name: 'Straße' })
  })

  it.each([
    ['an unparseable JSON Document', documentStructureOrigins.invalidJsonDocument, 'invalidJson'],
    ['an invalid JSON Schema', documentStructureOrigins.invalidJsonSchema, 'invalidJsonSchema'],
    ['an empty CSV Document', documentStructureOrigins.emptyCsvDocument, 'emptyDocument'],
    [
      'a Windows-1252 CSV Document read as UTF-8',
      {
        ...documentStructureOrigins.windows1252CsvDocument,
        csv: documentStructureOrigins.csvDocument.csv,
      },
      'unreadableContent',
    ],
  ] as const)('answers a typed 422 for %s', async (_, origin, code) => {
    const store = useHandlers()
    const count = store.all().length

    expect((await problemOf(await create(origin))).code).toBe(code)
    expect(store.all()).toHaveLength(count)
  })
})

describe('PUT /document-structures/:id', () => {
  const unused = seedUnusedDocumentStructures[1]!

  it('renames a structure and adjusts its nodes', async () => {
    useHandlers()

    const response = await put(unused.id, {
      name: 'Article master',
      adjustments: [
        { path: 'supplier', repeating: true },
        { path: 'description', required: false },
      ],
    })

    const updated = updateDocumentStructureEndpoint.response.parse(await response.json())

    expect(updated.name).toBe('Article master')
    expect(nodeAt(updated.children, 'supplier[]')).toMatchObject({ kind: 'array' })
    expect(nodeAt(updated.children, 'description')).toMatchObject({ required: false })
    expect(await (await getStructure(unused.id)).json()).toEqual(updated)
  })

  const orderVersions = seedMappingVersions.filter(
    ({ documentStructureId }) => documentStructureId === purchaseOrder.id,
  )

  const pathsOf = ({ links, transformLinks }: MappingVersionRecord) => [
    ...links.map(({ targetPath }) => targetPath),
    ...transformLinks.flatMap(({ to }) => (to.kind === 'target' ? [to.path] : [])),
  ]

  it('refuses a required or type change of a field a published Mapping Version links', async () => {
    useHandlers()

    const problem = await problemOf(
      await put(purchaseOrder.id, {
        name: purchaseOrder.name,
        adjustments: [{ path: 'buyer.gln', required: false, type: 'integer' }],
      }),
    )

    expect(problem).toMatchObject({ code: 'usedByMappingVersion', path: 'buyer.gln' })
    expect(problem.message).toContain('Hansemarkt: ORDERS to ERP JSON v3')
    expect(problem.mappingVersions?.map(({ id }) => id).sort()).toEqual(
      orderVersions
        .filter((version) => pathsOf(version).includes('buyer.gln'))
        .map(({ id }) => id)
        .sort(),
    )
  })

  it('refuses a change above a node a published Mapping Version links', async () => {
    useHandlers()

    for (const adjustment of [
      { path: 'buyer', required: false },
      { path: 'lines[]', repeating: false },
    ]) {
      const problem = await problemOf(
        await put(purchaseOrder.id, { name: purchaseOrder.name, adjustments: [adjustment] }),
      )

      expect(problem).toMatchObject({ code: 'usedByMappingVersion', path: adjustment.path })
    }
  })

  it('lets a used structure change a node no published Mapping Version links', async () => {
    useHandlers()
    const linked = new Set(orderVersions.flatMap(pathsOf))

    const unlinked = documentStructureLeaves(purchaseOrder).find(
      ({ path }) => !linked.has(path) && !path.startsWith('lines[]'),
    )!

    const response = await put(purchaseOrder.id, {
      name: purchaseOrder.name,
      adjustments: [{ path: unlinked.path, required: !unlinked.required, type: 'integer' }],
    })

    expect(response.status).toBe(200)
  })

  it('lets a structure only Drafts use change required-ness and types', async () => {
    useHandlers({ versions: [] })

    const response = await put(purchaseOrder.id, {
      name: purchaseOrder.name,
      adjustments: [{ path: 'buyer.gln', required: false, type: 'integer' }],
    })

    expect(response.status).toBe(200)
  })

  it('refuses to turn a node a Mapping Draft links into a list', async () => {
    useHandlers({ versions: [] })

    const problem = await problemOf(
      await put(seedDocumentStructureOf.ORDERS.id, {
        name: purchaseOrder.name,
        adjustments: [{ path: 'lines[]', repeating: false }],
      }),
    )

    expect(problem).toMatchObject({
      code: 'linkedByMapping',
      path: 'lines[]',
      mappingVersions: null,
    })
  })

  it('answers a typed 422 for a node it does not have', async () => {
    useHandlers()

    const problem = await problemOf(
      await put(unused.id, { name: unused.name, adjustments: [{ path: 'iban', required: true }] }),
    )

    expect(problem).toMatchObject({ code: 'unknownPath', path: 'iban' })
  })

  it('answers 404 for an unknown structure', async () => {
    useHandlers()

    expect((await put(crypto.randomUUID(), { name: 'x', adjustments: [] })).status).toBe(404)
  })
})

describe('PUT /document-structures/:id with CSV settings', () => {
  const dispatch = seedUnusedDocumentStructures[0]!
  const headerless = { delimiter: ',', headerRow: false, encoding: 'utf-8' } as const
  const document = toEncodedFile('dispatch.csv', 'LS-1,24\r\nLS-2,12\r\n')

  const dispatchVersion: MappingVersionRecord = {
    id: crypto.randomUUID(),
    mappingId: crypto.randomUUID(),
    mappingName: 'Hansemarkt: ERP CSV to DESADV',
    version: 1,
    publishedAt: '2026-10-01T08:00:00.000Z',
    messageType: 'DESADV',
    documentStructureId: dispatch.id,
    changeNote: null,
    publishedBy: { id: seedSession.user.id, name: seedSession.user.name },
    links: [],
    transforms: [],
    transformLinks: [],
  }

  it('reads the CSV Document of the update again with the new settings', async () => {
    useHandlers()

    const response = await put(dispatch.id, {
      name: dispatch.name,
      csv: headerless,
      document,
      adjustments: [],
    })

    const updated = updateDocumentStructureEndpoint.response.parse(await response.json())

    expect(updated).toMatchObject({ csv: headerless })
    expect(nodeAt(updated.children, 'rows[].column2')).toMatchObject({ type: 'integer' })
    expect(nodeAt(updated.children, 'rows[].Straße')).toBeUndefined()
    expect(await (await getStructure(dispatch.id)).json()).toEqual(updated)
  })

  it('answers csvDocumentRequired for new settings without a CSV Document', async () => {
    const store = useHandlers()

    const problem = await problemOf(
      await put(dispatch.id, { name: dispatch.name, csv: headerless, adjustments: [] }),
    )

    expect(problem.code).toBe('csvDocumentRequired')
    expect(store.get(dispatch.id)).toEqual(dispatch)
  })

  it('refuses new settings for a structure a published Mapping Version uses', async () => {
    useHandlers({ versions: [...seedMappingVersions, dispatchVersion] })

    const problem = await problemOf(
      await put(dispatch.id, { name: dispatch.name, csv: headerless, adjustments: [] }),
    )

    expect(problem).toMatchObject({
      code: 'usedByMappingVersion',
      path: null,
      mappingVersions: [{ id: dispatchVersion.id, version: 1 }],
    })
  })

  it('refuses a CSV Document that changes a column a published Mapping Version links', async () => {
    useHandlers({
      versions: [
        {
          ...dispatchVersion,
          links: [{ sourcePath: 'rows[].Menge', targetPath: 'QTY' }],
        },
      ],
    })

    const problem = await problemOf(
      await put(dispatch.id, {
        name: dispatch.name,
        document: toEncodedFile('dispatch.csv', 'Lieferscheinnummer;Menge\r\nLS-1;viele\r\n'),
        adjustments: [],
      }),
    )

    expect(problem).toMatchObject({ code: 'usedByMappingVersion', path: 'rows[].Menge' })
  })

  it('refuses CSV settings on a JSON structure', async () => {
    useHandlers()

    const problem = await problemOf(
      await put(purchaseOrder.id, {
        name: purchaseOrder.name,
        csv: headerless,
        document,
        adjustments: [],
      }),
    )

    expect(problem.code).toBe('notAdjustable')
  })
})

describe('createDocumentStructures', () => {
  it('generates the same list for the same seed', () => {
    expect(createDocumentStructures({ count: 8 })).toEqual(createDocumentStructures({ count: 8 }))
  })
})
