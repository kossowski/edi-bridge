import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  createMappingEndpoint,
  documentStructureEndpoint,
  documentStructureLeaves,
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
  edifactLeaves,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  createDocumentStructures,
  documentStructureHandlers,
  seedDocumentStructureOf,
  seedDocumentStructures,
} from './document-structure'
import { seedFlows, seedMappings } from './flow'
import { createLookupTables, lookupTableListHandler, seedLookupTables } from './lookup-table'
import {
  createMappingDrafts,
  createMappingDraftStore,
  createMappingsWithTraffic,
  mappingHandlers,
  type MappingDraftRecord,
  seedMappingDrafts,
  toMappingSummary,
  unpublishedDraftId,
} from './mapping'
import { messageTypeStructureHandler } from './message-type-structure'
import { day } from './overdue'
import { createRun } from './run'
import { seedRunsBeforeAll } from './test-helpers'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

seedRunsBeforeAll()

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

  it('serves a large volume of generated Mappings with their partners and traffic', async () => {
    server.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 300 })))
    const mappings = await listMappings()

    expect(mappings).toHaveLength(300)
    expect(mappings.some(({ partners }) => partners.length > 1)).toBe(true)
    expect(mappings.some(({ failedRunsLast7Days }) => failedRunsLast7Days > 0)).toBe(true)
    expect(
      mappings.some(
        ({ documentsLast7Days, failedRunsLast7Days }) =>
          documentsLast7Days > 0 && failedRunsLast7Days === 0,
      ),
    ).toBe(true)
    expect(mappings.some(({ latestVersion }) => latestVersion === null)).toBe(true)
  })

  it('names the Trading Partners whose Flows use each Mapping', async () => {
    server.use(...mappingHandlers(apiUrl))
    const mappings = await listMappings()

    for (const flow of seedFlows) {
      const { mappingId } = seedMappings.find(({ versions }) =>
        versions.some(({ id }) => id === flow.mappingVersionId),
      )!

      const tradingPartner = seedTradingPartners.find(({ id }) => id === flow.tradingPartnerId)!

      expect(mappings.find(({ id }) => id === mappingId)?.partners).toContainEqual({
        id: tradingPartner.id,
        name: tradingPartner.name,
      })
    }

    expect(mappings.find(({ id }) => id === unpublishedDraftId)?.partners).toEqual([])
  })

  it('seeds a Mapping that the Flows of two Trading Partners share', async () => {
    server.use(...mappingHandlers(apiUrl))
    const mappings = await listMappings()

    expect(mappings.some(({ partners }) => partners.length >= 2)).toBe(true)
  })

  it('counts the Documents and failed Runs of the last 7 days of the Flows using a Mapping', async () => {
    const [flow, otherFlow] = seedFlows
    const daysAgo = (days: number) => new Date(Date.now() - days * day).toISOString()
    const ofFlow = { id: flow!.id, name: flow!.name }

    const runs = [
      createRun({ flow: ofFlow, receivedAt: daysAgo(1), status: 'delivered', failureStage: null }),
      createRun({ flow: ofFlow, receivedAt: daysAgo(2), status: 'failed', failureStage: 'parse' }),
      createRun({ flow: ofFlow, receivedAt: daysAgo(6), status: 'processing', failureStage: null }),
      createRun({ flow: ofFlow, receivedAt: daysAgo(8), status: 'failed', failureStage: 'parse' }),
      createRun({
        flow: { id: otherFlow!.id, name: otherFlow!.name },
        receivedAt: daysAgo(1),
        status: 'failed',
        failureStage: 'parse',
      }),
    ]

    server.use(...mappingHandlers(apiUrl, { runs }))
    const mappings = await listMappings()
    const { mappingId } = seedMappings[0]!

    expect(mappings.find(({ id }) => id === mappingId)).toMatchObject({
      documentsLast7Days: 3,
      failedRunsLast7Days: 1,
    })
    expect(mappings.find(({ id }) => id === unpublishedDraftId)).toMatchObject({
      documentsLast7Days: 0,
      failedRunsLast7Days: 0,
    })
  })

  it('refuses to summarise a published Mapping whose latest version is missing', () => {
    const record = seedMappingDrafts.find(({ latestVersion }) => latestVersion !== null)!
    const facts = { partners: [], documentsLast7Days: 0, failedRunsLast7Days: 0 }

    expect(() => toMappingSummary(record, seedDocumentStructures, { facts, versions: [] })).toThrow(
      `Mapping ${record.id} has no published version ${record.latestVersion}`,
    )
  })

  it('tells when the latest version was published and whether the Draft changed since', async () => {
    server.use(...mappingHandlers(apiUrl))
    const mappings = await listMappings()

    for (const { mappingId, versions } of seedMappings) {
      expect(mappings.find(({ id }) => id === mappingId)).toMatchObject({
        latestVersionPublishedAt: versions[0]!.publishedAt,
        unpublishedChanges: seedMappingDrafts.find(({ id }) => id === mappingId)!
          .unpublishedChanges,
      })
    }

    expect(mappings.find(({ id }) => id === unpublishedDraftId)).toMatchObject({
      latestVersion: null,
      latestVersionPublishedAt: null,
      unpublishedChanges: true,
    })
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

async function createMapping(body: { messageType?: string }) {
  return fetch(`${apiUrl}${createMappingEndpoint.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /mappings', () => {
  it('creates a never-published Mapping for the Message Type, without traffic', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))
    const response = await createMapping({ messageType: 'INVOIC' })

    expect(response.status).toBe(201)
    expect(createMappingEndpoint.response.parse(await response.json())).toMatchObject({
      direction: 'outbound',
      messageType: 'INVOIC',
      latestVersion: null,
      latestVersionPublishedAt: null,
      unpublishedChanges: true,
      partners: [],
      documentsLast7Days: 0,
      failedRunsLast7Days: 0,
    })
  })

  it('uses the Document Structure the other Mappings of the Message Type use', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    const created = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: 'ORDERS' })).json(),
    )

    expect(created).toMatchObject({
      direction: 'inbound',
      documentStructureId: seedDocumentStructureOf.ORDERS.id,
      documentStructureName: seedDocumentStructureOf.ORDERS.name,
    })
  })

  it('falls back to the first Document Structure of the Workspace by name', async () => {
    const [first, second] = createDocumentStructures({ count: 2 }).toSorted((a, b) =>
      a.name.localeCompare(b.name, 'de'),
    )

    server.use(...mappingHandlers(apiUrl, { mappings: [], documentStructures: [second!, first!] }))

    const created = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: 'DESADV' })).json(),
    )

    expect(created.documentStructureId).toBe(first!.id)
  })

  it('takes the first by name of the Document Structures the Message Type uses', async () => {
    const [first, second] = createDocumentStructures({ count: 2 }).toSorted((a, b) =>
      a.name.localeCompare(b.name, 'de'),
    )

    const mappings = createMappingDrafts({ count: 1, documentStructures: [first!] }).flatMap(
      (mapping) => [
        { ...mapping, id: crypto.randomUUID(), documentStructureId: second!.id },
        mapping,
      ],
    )

    server.use(...mappingHandlers(apiUrl, { mappings, documentStructures: [second!, first!] }))

    const created = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: mappings[0]!.messageType })).json(),
    )

    expect(created.documentStructureId).toBe(first!.id)
  })

  it('opens the created Mapping with an empty Draft and lists it', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    const created = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: 'DESADV' })).json(),
    )

    expect(await getDraft(created.id)).toMatchObject({
      mappingId: created.id,
      name: created.name,
      direction: 'outbound',
      target: { kind: 'messageType', messageType: 'DESADV' },
      links: [],
      transforms: [],
      transformLinks: [],
      latestVersion: null,
      unpublishedChanges: true,
      aiReview: null,
    })
    expect(await listMappings()).toContainEqual(created)
  })

  it('gives a second Mapping of the same Message Type its own name', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [] }))

    const first = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: 'INVOIC' })).json(),
    )

    const second = createMappingEndpoint.response.parse(
      await (await createMapping({ messageType: 'INVOIC' })).json(),
    )

    expect(second.name).toBe(`${first.name} 2`)
  })

  it('creates the first Mapping of an empty Workspace from its Document Structures', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [] }))
    const response = await createMapping({ messageType: 'ORDERS' })

    expect(response.status).toBe(201)
    expect(await listMappings()).toEqual([
      createMappingEndpoint.response.parse(await response.json()),
    ])
  })

  it('refuses a Workspace without a Document Structure with a plain reason', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [], documentStructures: [] }))
    const response = await createMapping({ messageType: 'INVOIC' })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: 'The Workspace has no Document Structure to map yet.',
    })
  })

  it('fails listing and creating Mappings in the error state', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: 'error' }))

    expect((await get(mappingsEndpoint.path)).status).toBe(500)
    expect((await createMapping({ messageType: 'INVOIC' })).status).toBe(500)
  })

  it.each([{ messageType: 'CONTRL' }, { messageType: 'APERAK' }, {}])(
    'rejects the body %j',
    async (body) => {
      server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

      expect((await createMapping(body)).status).toBe(400)
    },
  )
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
        ...documentStructureHandlers(apiUrl),
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

  it('picks Lookup Tables for its Lookup Table Transforms from the listed ones', async () => {
    server.use(...mappingHandlers(apiUrl), lookupTableListHandler(apiUrl))
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
      ...documentStructureHandlers(apiUrl, { documentStructures: [documentStructure] }),
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

  it('drops the AI review marks of rejected and edited parts, but keeps the others', async () => {
    const graph = { links, transforms: [dateFormat], transformLinks: throughDateFormat }

    const reviewing: MappingDraftRecord = {
      ...hansemarktOrders,
      ...graph,
      aiReview: {
        sampleId: '00000008-0000-4000-8000-000000000001',
        proposedLinks: ['orderNumber', 'buyer.gln'],
        proposedTransforms: [dateFormat.id],
        proposedTransformLinks: ['target:requestedDeliveryDate'],
      },
    }

    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore([reviewing]) }))

    await saveDraft(reviewing.id, {
      links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
      transforms: [{ ...dateFormat, position: { x: 400, y: 400 } }],
      transformLinks: [
        throughDateFormat[0]!,
        { ...throughDateFormat[1]!, to: { kind: 'target', path: 'orderDate' } },
      ],
    })

    expect((await getDraft(reviewing.id)).aiReview).toEqual({
      ...reviewing.aiReview,
      proposedLinks: ['orderNumber'],
      proposedTransforms: [dateFormat.id],
      proposedTransformLinks: [],
    })
  })

  it.each([
    ['rejects', [links[0]!]],
    ['edits', [links[0]!, { ...links[1]!, sourcePath: 'BGM/1004' }]],
  ])('closes the AI review once a save %s the last proposed part', async (_, saved) => {
    const reviewing: MappingDraftRecord = {
      ...hansemarktOrders,
      links,
      transforms: [],
      transformLinks: [],
      aiReview: {
        sampleId: '00000008-0000-4000-8000-000000000001',
        proposedLinks: ['buyer.gln'],
        proposedTransforms: [],
        proposedTransformLinks: [],
      },
    }

    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore([reviewing]) }))

    const response = await saveDraft(reviewing.id, { links: saved })

    expect(response.status).toBe(200)
    expect(saveMappingDraftEndpoint.response.parse(await response.json()).aiReview).toBeNull()
    expect((await getDraft(reviewing.id)).aiReview).toBeNull()
  })

  it('saves a Draft without an AI review as one without', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    await saveDraft(hansemarktOrders.id, { links })

    expect((await getDraft(hansemarktOrders.id)).aiReview).toBeNull()
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect((await saveDraft(crypto.randomUUID(), { links })).status).toBe(404)
  })

  const lookupTable = (lookupTableId: string | null) =>
    ({
      id: '0000000a-0000-4000-8000-000000000003',
      kind: 'lookupTable',
      position: { x: 40, y: 320 },
      config: { lookupTableId, fallback: 'keepValue' },
    }) as const

  it.each([
    ['a Lookup Table of the Workspace', seedLookupTables[0]!.id],
    ['no Lookup Table chosen yet', null],
  ])('saves a Lookup Table Transform with %s', async (_, lookupTableId) => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    const response = await saveDraft(hansemarktOrders.id, {
      transforms: [lookupTable(lookupTableId)],
    })

    expect(response.status).toBe(200)
  })

  it('rejects a Lookup Table Transform whose Lookup Table is not in the Workspace', async () => {
    const theirs = crypto.randomUUID()

    server.use(
      ...mappingHandlers(apiUrl, { mappings: createMappingDraftStore(), lookupTables: [] }),
    )

    const response = await saveDraft(hansemarktOrders.id, { transforms: [lookupTable(theirs)] })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: `The Workspace has no Lookup Table ${theirs}.`,
    })
    expect((await getDraft(hansemarktOrders.id)).transforms).toEqual(hansemarktOrders.transforms)
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
    server.use(lookupTableListHandler(apiUrl))
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
    server.use(lookupTableListHandler(apiUrl, []))

    expect(await listLookupTables()).toEqual([])
  })

  it('serves a large volume of generated Lookup Tables', async () => {
    server.use(lookupTableListHandler(apiUrl, createLookupTables({ count: 250 })))
    const tables = await listLookupTables()

    expect(tables).toHaveLength(250)
    expect(new Set(tables.map(({ scope }) => scope.kind)).size).toBe(2)
  })
})
