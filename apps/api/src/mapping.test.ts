import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  lookupTableSchema,
  type MappingDraft,
  mappingDraftEndpoint,
  mappingDraftSchema,
  type MappingGraph,
  mappingsEndpoint,
  mappingSummarySchema,
  saveMappingDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { type Connection, documentStructures, lookupTables, mappings } from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let connection: Connection

let admin: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, otherAdmin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(mappings)
  await connection.db.delete(documentStructures)
  await connection.db.delete(lookupTables)
})

const postDocumentStructure = async (name: string, target = admin) => {
  const response = await target.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name, origin: documentStructureOrigins.jsonDocument },
  })

  expect(response.statusCode).toBe(201)

  return documentStructureSchema.parse(response.json())
}

const create = (messageType: string, target = admin) =>
  target.inject({ method: 'POST', url: createMappingEndpoint.path, body: { messageType } })

const created = async (messageType: string, target = admin) => {
  const response = await create(messageType, target)

  expect(response.statusCode).toBe(201)

  return mappingSummarySchema.parse(response.json())
}

const list = async (target = admin) => {
  const response = await target.inject({ method: 'GET', url: mappingsEndpoint.path })

  expect(response.statusCode).toBe(200)

  return mappingSummarySchema.array().parse(response.json())
}

describe('POST /mappings', () => {
  it('creates a never published Mapping between a Message Type and a Document Structure', async () => {
    const structure = await postDocumentStructure('ERP orders')

    const response = await create('ORDERS')

    expect(response.statusCode).toBe(201)

    const mapping = mappingSummarySchema.parse(response.json())

    expect(mapping).toEqual({
      id: mapping.id,
      name: 'ORDERS to ERP orders',
      direction: 'inbound',
      messageType: 'ORDERS',
      documentStructureId: structure.id,
      documentStructureName: 'ERP orders',
      latestVersion: null,
      latestVersionPublishedAt: null,
      unpublishedChanges: true,
      draftUpdatedAt: mapping.draftUpdatedAt,
      partners: [],
      documentsLast7Days: 0,
      failedRunsLast7Days: 0,
    })
    expect(await list()).toEqual([mapping])
  })

  it('names an outbound Mapping from the Document Structure to the Message Type', async () => {
    await postDocumentStructure('ERP dispatch')

    expect((await created('DESADV')).name).toBe('ERP dispatch to DESADV')
  })

  it('numbers the name of a second Mapping between the same sides', async () => {
    await postDocumentStructure('ERP orders')
    await created('ORDERS')

    expect((await created('ORDERS')).name).toBe('ORDERS to ERP orders 2')
  })

  it('takes the Document Structure another Mapping of the Message Type already uses', async () => {
    await postDocumentStructure('A orders')
    const first = await created('ORDERS')
    await postDocumentStructure('0 orders')

    expect((await created('ORDERS')).documentStructureId).toBe(first.documentStructureId)
  })

  it('takes the first Document Structure by name for a new Message Type', async () => {
    await postDocumentStructure('ERP orders')
    const dispatch = await postDocumentStructure('ERP dispatch')

    expect((await created('DESADV')).documentStructureId).toBe(dispatch.id)
  })

  it('answers 422 while the Workspace has no Document Structure', async () => {
    await postDocumentStructure('Sudhafen orders', otherAdmin)

    const response = await create('ORDERS')

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'The Workspace has no Document Structure to map yet.',
    })
  })

  it('answers 400 for a Message Type no Mapping is created for', async () => {
    await postDocumentStructure('ERP orders')

    expect((await create('CONTRL')).statusCode).toBe(400)
  })
})

describe('GET /mappings', () => {
  it('lists only the Mappings of the Workspace, by name', async () => {
    await postDocumentStructure('ERP orders')
    await postDocumentStructure('Sudhafen orders', otherAdmin)
    const second = await created('ORDERS')
    const first = await created('DESADV')
    await created('ORDERS', otherAdmin)

    expect((await list()).map(({ id }) => id)).toEqual([first.id, second.id])
  })
})

const draftUrl = (id: string) => toPath(mappingDraftEndpoint.path, { id })

const getDraft = (id: string, target = admin) => target.inject({ method: 'GET', url: draftUrl(id) })

const draftOf = async (id: string, target = admin) => {
  const response = await getDraft(id, target)

  expect(response.statusCode).toBe(200)

  return mappingDraftSchema.parse(response.json())
}

const save = (id: string, body: NonNullable<InjectOptions['body']>, target = admin) =>
  target.inject({ method: 'PUT', url: toPath(saveMappingDraftEndpoint.path, { id }), body })

const postLookupTable = async (target = admin) => {
  const response = await target.inject({
    method: 'POST',
    url: createLookupTableEndpoint.path,
    body: {
      name: 'Belegarten',
      kind: 'other',
      scope: { kind: 'workspace' },
      entries: [{ sourceCode: '220', targetCode: 'order' }],
    },
  })

  expect(response.statusCode).toBe(201)

  return lookupTableSchema.parse(response.json()).id
}

const lookupTransformId = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const graphWithLookup = (lookupTableId: string | null): MappingGraph => ({
  links: [{ sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' }],
  transforms: [
    {
      id: lookupTransformId,
      kind: 'lookupTable',
      position: { x: 320, y: 80 },
      config: { lookupTableId, fallback: 'keepValue' },
    },
  ],
  transformLinks: [
    {
      from: { kind: 'source', path: 'BGM/1004' },
      to: { kind: 'transform', transformId: lookupTransformId, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: lookupTransformId, output: 'value' },
      to: { kind: 'target', path: 'orderNumber' },
    },
  ],
})

const graphOf = ({ links, transforms, transformLinks }: MappingDraft) => ({
  links,
  transforms,
  transformLinks,
})

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

describe('GET /mappings/:id/draft', () => {
  it('serves the empty Draft of a new Mapping with its sides', async () => {
    const structure = await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')

    expect(await draftOf(mapping.id)).toEqual({
      mappingId: mapping.id,
      name: 'ORDERS to ERP orders',
      direction: 'inbound',
      source: { kind: 'messageType', messageType: 'ORDERS' },
      target: {
        kind: 'documentStructure',
        documentStructureId: structure.id,
        name: 'ERP orders',
      },
      links: [],
      transforms: [],
      transformLinks: [],
      updatedAt: mapping.draftUpdatedAt,
      latestVersion: null,
      unpublishedChanges: true,
      aiReview: null,
    })
  })

  it.each([
    ['an unknown id', () => unknownId],
    ['an id that is no uuid', () => 'not-a-uuid'],
  ])('answers 404 for %s', async (_, id) => {
    expect((await getDraft(id())).statusCode).toBe(404)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    await postDocumentStructure('Sudhafen orders', otherAdmin)
    const theirs = await created('ORDERS', otherAdmin)

    expect((await getDraft(theirs.id)).statusCode).toBe(404)
  })
})

describe('PUT /mappings/:id/draft', () => {
  it('saves the links, transforms and transform links of the Draft', async () => {
    await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')
    const lookupTableId = await postLookupTable()

    const response = await save(mapping.id, graphWithLookup(lookupTableId))

    expect(response.statusCode).toBe(200)

    const saved = mappingDraftSchema.parse(response.json())

    expect(graphOf(saved)).toEqual(graphWithLookup(lookupTableId))
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(mapping.draftUpdatedAt))
    expect(await draftOf(mapping.id)).toEqual(saved)
    expect((await list())[0]).toMatchObject({
      draftUpdatedAt: saved.updatedAt,
      unpublishedChanges: true,
    })
  })

  it('saves a Lookup Table Transform that has no Lookup Table chosen yet', async () => {
    await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')

    const response = await save(mapping.id, graphWithLookup(null))

    expect(response.statusCode).toBe(200)
    expect(graphOf(mappingDraftSchema.parse(response.json()))).toEqual(graphWithLookup(null))
  })

  it('answers 400 and keeps the Draft for a graph that links a target twice', async () => {
    await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')

    const response = await save(mapping.id, {
      links: [
        { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
        { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'orderNumber' },
      ],
      transforms: [],
      transformLinks: [],
    })

    expect(response.statusCode).toBe(400)
    expect(graphOf(await draftOf(mapping.id))).toEqual({
      links: [],
      transforms: [],
      transformLinks: [],
    })
  })

  it.each([
    [
      'source',
      { sourcePath: 'BGM/9999', targetPath: 'orderNumber' },
      'The source has no field or element at BGM/9999',
    ],
    [
      'target',
      { sourcePath: 'BGM/1004', targetPath: 'buyer.fax' },
      'The target has no field or element at buyer.fax',
    ],
  ])('answers 422 for a link from an unknown %s path', async (_, link, message) => {
    await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')

    const response = await save(mapping.id, { links: [link], transforms: [], transformLinks: [] })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message })
  })

  it('answers 422 for a Lookup Table Transform with a Lookup Table outside the Workspace', async () => {
    await postDocumentStructure('ERP orders')
    const mapping = await created('ORDERS')
    const theirs = await postLookupTable(otherAdmin)

    const response = await save(mapping.id, graphWithLookup(theirs))

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: `The Workspace has no Lookup Table ${theirs}.` })
    expect(graphOf(await draftOf(mapping.id)).transforms).toEqual([])
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    await postDocumentStructure('Sudhafen orders', otherAdmin)
    const theirs = await created('ORDERS', otherAdmin)

    const response = await save(theirs.id, graphWithLookup(null))

    expect(response.statusCode).toBe(404)
    expect(graphOf(await draftOf(theirs.id, otherAdmin)).links).toEqual([])
  })
})
