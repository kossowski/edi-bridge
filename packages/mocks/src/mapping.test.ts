import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  documentStructureEndpoint,
  type MappingDraft,
  mappingDraftEndpoint,
  type MappingLink,
  mappingsEndpoint,
  messageTypeStructureEndpoint,
  saveMappingLinksEndpoint,
  toPath,
} from '@edi-bridge/contracts'

import { createDocumentStructure, documentStructureLeaves } from './document-structure'
import { seedMappings } from './flow'
import {
  createMappingDrafts,
  createMappingDraftStore,
  mappingHandlers,
  type MappingDraftRecord,
  seedMappingDrafts,
} from './mapping'
import { edifactLeaves } from './message-type-structure'

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

async function saveLinks(id: string, links: ReadonlyArray<MappingLink>) {
  return fetch(`${apiUrl}${toPath(saveMappingLinksEndpoint.path, { id })}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ links }),
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

function seeded(name: string) {
  return seedMappingDrafts.find((mapping) => mapping.name === name)!
}

const hansemarktOrders = seeded('Hansemarkt: ORDERS to ERP JSON')

const hansemarktDesadv = seeded('Hansemarkt: ERP JSON to DESADV')

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
      server.use(...mappingHandlers(apiUrl))
      const draft = await getDraft(mapping.id)
      const leaves = await leavesOf(draft)

      for (const { sourcePath, targetPath } of draft.links) {
        expect(leaves.source).toContain(sourcePath)
        expect(leaves.target).toContain(targetPath)
      }
    },
  )

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

    server.use(...mappingHandlers(apiUrl, { mappings, documentStructures: [documentStructure] }))

    for (const mapping of mappings) {
      const draft = await getDraft(mapping.id)
      const leaves = await leavesOf(draft)

      expect(draft.links.length).toBeGreaterThan(50)

      for (const { sourcePath, targetPath } of draft.links) {
        expect(leaves.source).toContain(sourcePath)
        expect(leaves.target).toContain(targetPath)
      }
    }
  })
})

describe('PUT /mappings/:id/draft/links', () => {
  const links = [
    { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
    { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' },
  ]

  it('saves the links of the Draft', async () => {
    const store = createMappingDraftStore()
    server.use(...mappingHandlers(apiUrl, { mappings: store }))

    const response = await saveLinks(hansemarktOrders.id, links)
    const saved = saveMappingLinksEndpoint.response.parse(await response.json())

    expect(saved.links).toEqual(links)
    expect(saved.updatedAt > hansemarktOrders.updatedAt).toBe(true)
    await expect(getDraft(hansemarktOrders.id)).resolves.toEqual(saved)
  })

  it('removes every link', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: createMappingDraftStore() }))

    await saveLinks(hansemarktOrders.id, [])

    expect((await getDraft(hansemarktOrders.id)).links).toEqual([])
  })

  it('keeps the changes of one handler set out of another', async () => {
    server.use(...mappingHandlers(apiUrl))
    await saveLinks(hansemarktOrders.id, [])

    server.resetHandlers(...mappingHandlers(apiUrl))

    expect((await getDraft(hansemarktOrders.id)).links).toEqual(hansemarktOrders.links)
  })

  it('rejects a second link into the same target', async () => {
    server.use(...mappingHandlers(apiUrl))

    const response = await saveLinks(hansemarktOrders.id, [
      ...links,
      { sourcePath: 'SG2+SU/NAD+SU/C082/3039', targetPath: 'buyer.gln' },
    ])

    expect(response.status).toBe(400)
  })

  it.each([
    ['a source path that does not exist', { sourcePath: 'XYZ/1004', targetPath: 'orderNumber' }],
    ['a target path that does not exist', { sourcePath: 'BGM/1004', targetPath: 'order.no' }],
    ['a segment instead of an element', { sourcePath: 'DTM+137', targetPath: 'orderDate' }],
    ['an object instead of a field', { sourcePath: 'BGM/1004', targetPath: 'buyer' }],
    ['the wrong direction', { sourcePath: 'orderNumber', targetPath: 'BGM/1004' }],
  ])('rejects %s', async (_, link) => {
    server.use(...mappingHandlers(apiUrl))

    expect((await saveLinks(hansemarktOrders.id, [link])).status).toBe(422)
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingHandlers(apiUrl))

    expect((await saveLinks(crypto.randomUUID(), links)).status).toBe(404)
  })
})
