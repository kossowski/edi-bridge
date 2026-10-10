import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  documentStructureEndpoint,
  lookupTablesEndpoint,
  type MappingDraft,
  mappingDraftEndpoint,
  type MappingGraph,
  mappingsEndpoint,
  messageTypeStructureEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  transformConfigIssues,
  type TransformLink,
  transformPorts,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  documentStructureHandler,
  documentStructureLeaves,
} from './document-structure'
import { seedMappings } from './flow'
import { createLookupTables, lookupTablesHandler, seedLookupTables } from './lookup-table'
import {
  createMappingDrafts,
  createMappingDraftStore,
  mappingHandlers,
  type MappingDraftRecord,
  seedMappingDrafts,
} from './mapping'
import { edifactLeaves, messageTypeStructureHandler } from './message-type-structure'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function get(path: string) {
  return fetch(`${apiUrl}${path}`)
}

async function listMappings() {
  return mappingsEndpoint.response.parse(await (await get(mappingsEndpoint.path)).json())
}

async function getDraft(id: string) {
  const response = await get(toPath(mappingDraftEndpoint.path, { id }))

  return mappingDraftEndpoint.response.parse(await response.json())
}

async function saveDraft(id: string, graph: Partial<MappingGraph>) {
  return fetch(`${apiUrl}${toPath(saveMappingDraftEndpoint.path, { id })}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ links: [], transforms: [], transformLinks: [], ...graph }),
  })
}

// Resolves both sides of a Draft through the structure endpoints, as the canvas does.
async function leavesOf(draft: MappingDraft) {
  const side = async (part: MappingDraft['source']) => {
    if (part.kind === 'messageType') {
      const response = await get(toPath(messageTypeStructureEndpoint.path, part))

      return edifactLeaves(messageTypeStructureEndpoint.response.parse(await response.json()))
    }

    const response = await get(
      toPath(documentStructureEndpoint.path, { id: part.documentStructureId }),
    )

    return documentStructureLeaves(documentStructureEndpoint.response.parse(await response.json()))
  }

  const [source, target] = await Promise.all([side(draft.source), side(draft.target)])

  return {
    source: new Set(source.map(({ path }) => path)),
    target: new Set(target.map(({ path }) => path)),
  }
}

function containerOf(leaves: ReadonlySet<string>, path: string) {
  return [...leaves].some((leaf) => leaf.startsWith(`${path}/`) || leaf.startsWith(`${path}.`))
}

// Loops take and fill whole parts, every other link starts and ends at a field or element.
function expectExistingEnds(draft: MappingDraft, leaves: Awaited<ReturnType<typeof leavesOf>>) {
  const kindOf = new Map(draft.transforms.map(({ id, kind }) => [id, kind]))

  for (const { from, to } of draft.transformLinks) {
    if (from.kind === 'source') {
      const intoLoop = to.kind === 'transform' && kindOf.get(to.transformId) === 'loop'

      expect(
        leaves.source.has(from.path) || (intoLoop && containerOf(leaves.source, from.path)),
      ).toBe(true)
    }

    if (to.kind === 'target') {
      const loopItems = from.kind === 'transform' && from.output === 'items'

      expect(leaves.target.has(to.path) || (loopItems && containerOf(leaves.target, to.path))).toBe(
        true,
      )
    }
  }
}

function seeded(name: string) {
  return seedMappingDrafts.find((mapping) => mapping.name === name)!
}

const hansemarktOrders = seeded('Hansemarkt: ORDERS to ERP JSON')

const hansemarktDesadv = seeded('Hansemarkt: ERP JSON to DESADV')

const hansemarktInvoic = seeded('Hansemarkt: ERP JSON to INVOIC')

describe('GET /mappings', () => {
  it('lists the seed Mappings in both directions, sorted by name', async () => {
    server.use(...mappingHandlers(apiUrl))
    const mappings = await listMappings()

    expect(new Set(mappings.map(({ direction }) => direction))).toEqual(
      new Set(['inbound', 'outbound']),
    )
    expect(mappings.map(({ name }) => name)).toEqual(
      mappings.map(({ name }) => name).sort((a, b) => a.localeCompare(b, 'de')),
    )
  })

  it('lists the Mappings the Flows are pinned to, with their newest version', async () => {
    server.use(...mappingHandlers(apiUrl))
    const mappings = await listMappings()

    for (const { mappingId, versions } of seedMappings) {
      expect(mappings.find(({ id }) => id === mappingId)).toMatchObject({
        latestVersion: versions[0]!.version,
      })
    }
  })

  it('lists a Mapping that has never been published', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect((await listMappings()).some(({ latestVersion }) => latestVersion === null)).toBe(true)
  })

  it('serves an empty list', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [] }))

    expect(await listMappings()).toEqual([])
  })

  it('serves a large volume of generated Mappings in both directions', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDrafts({ count: 300 }) }))
    const mappings = await listMappings()

    expect(mappings).toHaveLength(300)
    expect(new Set(mappings.map(({ direction }) => direction))).toEqual(
      new Set(['inbound', 'outbound']),
    )
  })
})

describe('GET /mappings/:id/draft', () => {
  it('reads an inbound Draft from the Message Type into the ERP Document', async () => {
    server.use(...mappingHandlers(apiUrl))
    const draft = await getDraft(hansemarktOrders.id)

    expect(draft).toMatchObject({
      direction: 'inbound',
      source: { kind: 'messageType', messageType: 'ORDERS' },
      target: { kind: 'documentStructure', name: 'ERP purchase order' },
    })
    expect(draft.links).toContainEqual({
      sourcePath: 'DTM+137/C507/2380',
      targetPath: 'orderDate',
    })
    expect(draft.links).toContainEqual({
      sourcePath: 'SG25/QTY+21/C186/6060',
      targetPath: 'lines[].quantity',
    })
  })

  it('writes an outbound Draft from the ERP Document into the Message Type', async () => {
    server.use(...mappingHandlers(apiUrl))
    const draft = await getDraft(hansemarktDesadv.id)

    expect(draft).toMatchObject({
      direction: 'outbound',
      source: { kind: 'documentStructure', name: 'ERP dispatch advice' },
      target: { kind: 'messageType', messageType: 'DESADV' },
    })
    expect(draft.links).toContainEqual({
      sourcePath: 'packages[].sscc',
      targetPath: 'SG10/SG11/SG13/SG15/GIN+BJ/C208/7402',
    })
  })

  it('includes a Draft without any links', async () => {
    server.use(...mappingHandlers(apiUrl))
    const drafts = await Promise.all(seedMappingDrafts.map(({ id }) => getDraft(id)))

    expect(drafts.some(({ links }) => links.length === 0)).toBe(true)
  })

  it.each(seedMappingDrafts.map((mapping) => [mapping.name, mapping] as const))(
    'links only existing fields and elements in %s',
    async (_, mapping: MappingDraftRecord) => {
      server.use(
        ...mappingHandlers(apiUrl),
        documentStructureHandler(apiUrl),
        messageTypeStructureHandler(apiUrl),
      )
      const draft = await getDraft(mapping.id)
      const leaves = await leavesOf(draft)

      for (const { sourcePath, targetPath } of draft.links) {
        expect(leaves.source).toContain(sourcePath)
        expect(leaves.target).toContain(targetPath)
      }

      expectExistingEnds(draft, leaves)
    },
  )

  it('places transforms on the seed Drafts, some of them configured wrongly', async () => {
    server.use(...mappingHandlers(apiUrl))
    const drafts = await Promise.all(seedMappingDrafts.map(({ id }) => getDraft(id)))
    const transforms = drafts.flatMap((draft) => draft.transforms)

    expect(new Set(transforms.map(({ kind }) => kind)).size).toBe(10)
    expect(transforms.some((transform) => transformConfigIssues(transform).length > 0)).toBe(true)
    expect(transforms.some((transform) => transformConfigIssues(transform).length === 0)).toBe(true)
  })

  it('links a source field through a transform into a target element', async () => {
    server.use(...mappingHandlers(apiUrl))
    const draft = await getDraft(hansemarktInvoic.id)

    const dateFormat = draft.transforms.find(({ kind }) => kind === 'dateFormat')!

    expect(draft.transformLinks).toEqual(
      expect.arrayContaining([
        {
          from: { kind: 'source', path: 'invoiceDate' },
          to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
        },
        {
          from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
          to: { kind: 'target', path: 'DTM+137/C507/2380' },
        },
      ]),
    )
    expect(draft.links.map(({ targetPath }) => targetPath)).not.toContain('DTM+137/C507/2380')
  })

  it('keeps the Draft without links free of transforms', async () => {
    server.use(...mappingHandlers(apiUrl))
    const drafts = await Promise.all(seedMappingDrafts.map(({ id }) => getDraft(id)))

    for (const draft of drafts.filter(({ links }) => links.length === 0)) {
      expect(draft.transforms).toEqual([])
      expect(draft.transformLinks).toEqual([])
    }
  })

  it('picks Lookup Tables for its Lookup Table nodes from the listed ones', async () => {
    server.use(...mappingHandlers(apiUrl), lookupTablesHandler(apiUrl))
    const drafts = await Promise.all(seedMappingDrafts.map(({ id }) => getDraft(id)))

    const listed = lookupTablesEndpoint.response.parse(
      await (await get(lookupTablesEndpoint.path)).json(),
    )

    const picked = drafts
      .flatMap(({ transforms }) => transforms)
      .flatMap((transform) =>
        transform.kind === 'lookupTable' && transform.config.lookupTableId !== null
          ? [transform.config.lookupTableId]
          : [],
      )

    expect(picked.length).toBeGreaterThan(0)
    expect(listed.map(({ id }) => id)).toEqual(expect.arrayContaining(picked))
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect((await get(toPath(mappingDraftEndpoint.path, { id: crypto.randomUUID() }))).status).toBe(
      404,
    )
  })

  it('serves a large canvas with many fields and links', async () => {
    const documentStructure = createDocumentStructure({ fieldCount: 400 })

    const mappings = createMappingDrafts({
      count: 2,
      documentStructures: [documentStructure],
    })

    server.use(
      ...mappingHandlers(apiUrl, { mappings, documentStructures: [documentStructure] }),
      documentStructureHandler(apiUrl, [documentStructure]),
      messageTypeStructureHandler(apiUrl),
    )

    for (const mapping of mappings) {
      const draft = await getDraft(mapping.id)
      const leaves = await leavesOf(draft)

      expect(draft.links.length).toBeGreaterThan(50)
      expect(draft.transforms.length).toBeGreaterThan(20)

      for (const { sourcePath, targetPath } of draft.links) {
        expect(leaves.source).toContain(sourcePath)
        expect(leaves.target).toContain(targetPath)
      }

      expectExistingEnds(draft, leaves)
    }
  })
})

describe('PUT /mappings/:id/draft', () => {
  const links = [
    { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
    { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' },
  ]

  const dateFormat = {
    id: '0000000a-0000-4000-8000-000000000001',
    kind: 'dateFormat',
    position: { x: 40, y: 80 },
    config: { from: 'yyyyMMdd', to: 'yyyy-MM-dd' },
  } as const

  const loop = {
    id: '0000000a-0000-4000-8000-000000000002',
    kind: 'loop',
    position: { x: 40, y: 200 },
    config: { counterStart: 1 },
  } as const

  const throughDateFormat: TransformLink[] = [
    {
      from: { kind: 'source', path: 'DTM+2/C507/2380' },
      to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
      to: { kind: 'target', path: 'requestedDeliveryDate' },
    },
  ]

  it('saves the links and transforms of the Draft together', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    const graph = { links, transforms: [dateFormat], transformLinks: throughDateFormat }
    const response = await saveDraft(hansemarktOrders.id, graph)
    const saved = saveMappingDraftEndpoint.response.parse(await response.json())

    expect(saved).toMatchObject(graph)
    expect(saved.updatedAt > hansemarktOrders.updatedAt).toBe(true)
    await expect(getDraft(hansemarktOrders.id)).resolves.toEqual(saved)
  })

  it('saves a transform whose configuration is still invalid', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))
    const unfinished = { ...dateFormat, config: { from: '', to: 'yyyyMMdd' } }

    await saveDraft(hansemarktOrders.id, { transforms: [unfinished] })

    expect((await getDraft(hansemarktOrders.id)).transforms).toEqual([unfinished])
  })

  it('loops over a repeated part and fills one', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    const transformLinks: TransformLink[] = [
      {
        from: { kind: 'source', path: 'SG25' },
        to: { kind: 'transform', transformId: loop.id, input: 'items' },
      },
      {
        from: { kind: 'transform', transformId: loop.id, output: 'items' },
        to: { kind: 'target', path: 'lines[]' },
      },
    ]

    expect(
      (await saveDraft(hansemarktOrders.id, { transforms: [loop], transformLinks })).status,
    ).toBe(200)
  })

  it('removes every link and transform', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    await saveDraft(hansemarktOrders.id, {})

    expect(await getDraft(hansemarktOrders.id)).toMatchObject({
      links: [],
      transforms: [],
      transformLinks: [],
    })
  })

  it('keeps the changes of one handler set out of another', async () => {
    server.use(...mappingHandlers(apiUrl))
    await saveDraft(hansemarktOrders.id, {})

    server.resetHandlers(...mappingHandlers(apiUrl))

    expect(await getDraft(hansemarktOrders.id)).toMatchObject({
      links: hansemarktOrders.links,
      transforms: hansemarktOrders.transforms,
    })
  })

  it('rejects a second link into the same target', async () => {
    server.use(...mappingHandlers(apiUrl))

    const response = await saveDraft(hansemarktOrders.id, {
      links: [...links, { sourcePath: 'SG2+SU/NAD+SU/C082/3039', targetPath: 'buyer.gln' }],
    })

    expect(response.status).toBe(400)
  })

  it('rejects a link into a transform that is not saved with it', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect(
      (await saveDraft(hansemarktOrders.id, { transformLinks: throughDateFormat })).status,
    ).toBe(400)
  })

  it.each([
    ['a source path that does not exist', { sourcePath: 'XYZ/1004', targetPath: 'orderNumber' }],
    ['a target path that does not exist', { sourcePath: 'BGM/1004', targetPath: 'order.no' }],
    ['a segment instead of an element', { sourcePath: 'DTM+137', targetPath: 'orderDate' }],
    ['an object instead of a field', { sourcePath: 'BGM/1004', targetPath: 'buyer' }],
    ['the wrong direction', { sourcePath: 'orderNumber', targetPath: 'BGM/1004' }],
  ])('rejects %s', async (_, link) => {
    server.use(...mappingHandlers(apiUrl))

    expect((await saveDraft(hansemarktOrders.id, { links: [link] })).status).toBe(422)
  })

  it.each([
    [
      'a transform input fed from a field that does not exist',
      {
        from: { kind: 'source', path: 'XYZ/1004' },
        to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
      },
    ],
    [
      'a transform input fed from a whole part',
      {
        from: { kind: 'source', path: 'SG25' },
        to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
      },
    ],
    [
      'a transform output into a target that does not exist',
      {
        from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
        to: { kind: 'target', path: 'order.no' },
      },
    ],
    [
      'a transform output into a whole part',
      {
        from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
        to: { kind: 'target', path: 'lines[]' },
      },
    ],
  ] as const)('rejects %s', async (_, link) => {
    server.use(...mappingHandlers(apiUrl))

    const response = await saveDraft(hansemarktOrders.id, {
      transforms: [dateFormat],
      transformLinks: [link],
    })

    expect(response.status).toBe(422)
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect((await saveDraft(crypto.randomUUID(), { links })).status).toBe(404)
  })
})

describe('createMappingDrafts', () => {
  it('connects only the ports its transforms have', () => {
    const documentStructure = createDocumentStructure({ fieldCount: 400 })

    for (const draft of createMappingDrafts({
      count: 4,
      documentStructures: [documentStructure],
    })) {
      const ports = new Map(
        draft.transforms.map((transform) => [transform.id, transformPorts(transform)]),
      )

      for (const { from, to } of draft.transformLinks) {
        if (from.kind === 'transform') {
          expect(ports.get(from.transformId)?.outputs).toContain(from.output)
        }

        if (to.kind === 'transform') {
          expect(ports.get(to.transformId)?.inputs).toContain(to.input)
        }
      }
    }
  })
})

describe('GET /lookup-tables', () => {
  async function listLookupTables() {
    return lookupTablesEndpoint.response.parse(await (await get(lookupTablesEndpoint.path)).json())
  }

  it('lists the Lookup Tables of the Workspace and of single Trading Partners, by name', async () => {
    server.use(lookupTablesHandler(apiUrl))
    const tables = await listLookupTables()

    expect(new Set(tables.map(({ scope }) => scope.kind))).toEqual(
      new Set(['workspace', 'tradingPartner']),
    )
    expect(tables.map(({ name }) => name)).toEqual(
      tables.map(({ name }) => name).sort((a, b) => a.localeCompare(b, 'de')),
    )
    expect(tables).toHaveLength(seedLookupTables.length)
  })

  it('serves an empty list', async () => {
    server.use(lookupTablesHandler(apiUrl, []))

    expect(await listLookupTables()).toEqual([])
  })

  it('serves a large volume of generated Lookup Tables', async () => {
    server.use(lookupTablesHandler(apiUrl, createLookupTables({ count: 250 })))
    const tables = await listLookupTables()

    expect(tables).toHaveLength(250)
    expect(new Set(tables.map(({ scope }) => scope.kind)).size).toBe(2)
  })
})
