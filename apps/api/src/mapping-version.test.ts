import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  createDocumentStructureEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  type MappingGraph,
  mappingDraftEndpoint,
  mappingDraftSchema,
  mappingsEndpoint,
  mappingVersionEndpoint,
  type MappingVersionEntry,
  mappingVersionEntrySchema,
  mappingVersionSchema,
  mappingVersionsEndpoint,
  mappingSummarySchema,
  mappingVersionSummarySchema,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  restoreMappingVersionEndpoint,
  saveMappingDraftEndpoint,
  sessionEndpoint,
  sessionSchema,
  toPath,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import { type Connection, documentStructures, mappings } from '@edi-bridge/db'

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
})

const createdMapping = async (target = admin) => {
  const structure = await target.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument },
  })

  expect(structure.statusCode).toBe(201)

  const response = await target.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType: 'ORDERS' },
  })

  expect(response.statusCode).toBe(201)

  return mappingSummarySchema.parse(response.json())
}

const orderNumber: MappingGraph = {
  links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
  transforms: [],
  transformLinks: [],
}

const save = async (id: string, graph: MappingGraph, target = admin) => {
  const response = await target.inject({
    method: 'PUT',
    url: toPath(saveMappingDraftEndpoint.path, { id }),
    body: graph,
  })

  expect(response.statusCode).toBe(200)
}

const publish = (mappingId: string, body: NonNullable<InjectOptions['body']>, target = admin) =>
  target.inject({
    method: 'POST',
    url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
    body,
  })

const versionsOf = async (mappingId: string, target = admin) => {
  const response = await target.inject({
    method: 'GET',
    url: toPath(mappingVersionsEndpoint.path, { mappingId }),
  })

  expect(response.statusCode).toBe(200)

  return mappingVersionEntrySchema.array().parse(response.json())
}

const published = async (mappingId: string, changeNote = 'Order number mapped', target = admin) => {
  const response = await publish(mappingId, { changeNote }, target)

  expect(response.statusCode).toBe(201)

  return mappingVersionEntrySchema.parse(response.json())
}

const versionUrl = (mappingId: string, versionId: string) =>
  toPath(mappingVersionEndpoint.path, { mappingId, versionId })

const versionOf = async (mappingId: string, versionId: string) => {
  const response = await admin.inject({ method: 'GET', url: versionUrl(mappingId, versionId) })

  expect(response.statusCode).toBe(200)

  return mappingVersionSchema.parse(response.json())
}

const draftOf = async (id: string) => {
  const response = await admin.inject({
    method: 'GET',
    url: toPath(mappingDraftEndpoint.path, { id }),
  })

  expect(response.statusCode).toBe(200)

  return mappingDraftSchema.parse(response.json())
}

const summaryOf = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: mappingsEndpoint.path })

  expect(response.statusCode).toBe(200)

  return mappingSummarySchema
    .array()
    .parse(response.json())
    .find((mapping) => mapping.id === id)
}

const buyerGln: MappingGraph = {
  links: [{ sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' }],
  transforms: [],
  transformLinks: [],
}

const lookupTransformId = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const lookupWithoutTable: MappingGraph = {
  links: [],
  transforms: [
    {
      id: lookupTransformId,
      kind: 'lookupTable',
      position: { x: 320, y: 80 },
      config: { lookupTableId: null, fallback: 'keepValue' },
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
}

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const restore = (mappingId: string, versionId: string, target = admin) =>
  target.inject({
    method: 'POST',
    url: toPath(restoreMappingVersionEndpoint.path, { mappingId, versionId }),
  })

const created = async (messageType: string) => {
  const response = await admin.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType },
  })

  expect(response.statusCode).toBe(201)

  return mappingSummarySchema.parse(response.json())
}

const publishedVersions = async (messageType?: string) => {
  const query = messageType === undefined ? '' : `?messageType=${messageType}`

  const response = await admin.inject({
    method: 'GET',
    url: `${publishedMappingVersionsEndpoint.path}${query}`,
  })

  expect(response.statusCode).toBe(200)

  return mappingVersionSummarySchema.array().parse(response.json())
}

const signedInUser = async (target = admin) => {
  const response = await target.inject({ method: 'GET', url: sessionEndpoint.path })

  return sessionSchema.parse(response.json()).user
}

describe('POST /mappings/:mappingId/versions', () => {
  it('publishes the Draft as version 1 with its change note and publisher', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const { id, name } = await signedInUser()

    const response = await publish(mapping.id, { changeNote: '  Order number mapped  ' })

    expect(response.statusCode).toBe(201)

    const published = mappingVersionEntrySchema.parse(response.json())

    expect(published).toEqual({
      id: published.id,
      mappingId: mapping.id,
      mappingName: 'ORDERS to ERP orders',
      version: 1,
      publishedAt: published.publishedAt,
      changeNote: 'Order number mapped',
      publishedBy: { id, name },
      flows: [],
    })
    expect(await versionsOf(mapping.id)).toEqual([published])
  })

  it('numbers the next version and lists the history newest first', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const first = await published(mapping.id)
    await save(mapping.id, buyerGln)

    const second = await published(mapping.id, 'Buyer GLN mapped')

    expect(second).toMatchObject({ version: 2, changeNote: 'Buyer GLN mapped' })
    expect(await versionsOf(mapping.id)).toEqual([second, first])
  })

  it('records a blank change note as none', async () => {
    const mapping = await createdMapping()

    expect((await published(mapping.id, '   ')).changeNote).toBeNull()
  })

  it('answers 409 and publishes nothing while the Draft has no changes since its latest version', async () => {
    const mapping = await createdMapping()
    await published(mapping.id)

    const response = await publish(mapping.id, { changeNote: 'Again' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      message: 'The Draft has no changes since its latest version.',
    })
    expect(await versionsOf(mapping.id)).toHaveLength(1)
  })

  it('publishes one version when the same Draft is published twice at once', async () => {
    const mapping = await createdMapping()

    const statuses = await Promise.all(
      [1, 2, 3].map(async () => (await publish(mapping.id, { changeNote: '' })).statusCode),
    )

    expect(statuses.toSorted()).toEqual([201, 409, 409])
    expect(await versionsOf(mapping.id)).toHaveLength(1)
  })

  it('answers 422 and publishes nothing while the Draft links a path its Document Structure no longer has', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, buyerGln)

    const changed = await admin.inject({
      method: 'PUT',
      url: toPath(updateDocumentStructureEndpoint.path, { id: mapping.documentStructureId }),
      body: { name: 'ERP orders', adjustments: [{ path: 'buyer', repeating: true }] },
    })

    expect(changed.statusCode).toBe(200)

    const response = await publish(mapping.id, { changeNote: '' })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'The target has no field or element at buyer.gln',
    })
    expect(await versionsOf(mapping.id)).toEqual([])
  })

  it('answers 422 and publishes nothing while a transform lacks its configuration', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, lookupWithoutTable)

    const response = await publish(mapping.id, { changeNote: '' })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'Every transform is configured and connected before publishing.',
    })
    expect(await versionsOf(mapping.id)).toEqual([])
  })

  it('answers 422 for a Flow to move, since no Flow uses the Mapping yet', async () => {
    const mapping = await createdMapping()

    const response = await publish(mapping.id, { changeNote: '', moveFlowIds: [unknownId] })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'Only Flows that use this Mapping move to the new version.',
    })
    expect(await versionsOf(mapping.id)).toEqual([])
  })

  it('answers 400 for a change note longer than the limit', async () => {
    const mapping = await createdMapping()

    const response = await publish(mapping.id, { changeNote: 'x'.repeat(501) })

    expect(response.statusCode).toBe(400)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const theirs = await createdMapping(otherAdmin)

    expect((await publish(theirs.id, { changeNote: '' })).statusCode).toBe(404)
    expect(await versionsOf(theirs.id, otherAdmin)).toEqual([])
  })
})

describe('a published Mapping Version', () => {
  it('names the latest version on the Mapping and its Draft until the Draft changes', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const version = await published(mapping.id)

    expect(await summaryOf(mapping.id)).toMatchObject({
      latestVersion: 1,
      latestVersionPublishedAt: version.publishedAt,
      unpublishedChanges: false,
    })
    expect(await draftOf(mapping.id)).toMatchObject({ latestVersion: 1, unpublishedChanges: false })

    await save(mapping.id, buyerGln)

    expect(await summaryOf(mapping.id)).toMatchObject({
      latestVersion: 1,
      unpublishedChanges: true,
    })
    expect(await draftOf(mapping.id)).toMatchObject({ latestVersion: 1, unpublishedChanges: true })
  })

  it('keeps its graph when the Draft is saved afterwards', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const version = await published(mapping.id)

    await save(mapping.id, buyerGln)

    expect(await versionOf(mapping.id, version.id)).toEqual({
      id: version.id,
      mappingId: mapping.id,
      mappingName: 'ORDERS to ERP orders',
      version: 1,
      publishedAt: version.publishedAt,
      direction: 'inbound',
      source: { kind: 'messageType', messageType: 'ORDERS' },
      target: {
        kind: 'documentStructure',
        documentStructureId: mapping.documentStructureId,
        name: 'ERP orders',
      },
      ...orderNumber,
    })
  })
})

describe('GET /mappings/:mappingId/versions', () => {
  it.each([
    ['an unknown Mapping', () => Promise.resolve(unknownId)],
    ['a Mapping of another Workspace', async () => (await createdMapping(otherAdmin)).id],
  ])('answers 404 for %s', async (_, mappingId) => {
    const response = await admin.inject({
      method: 'GET',
      url: toPath(mappingVersionsEndpoint.path, { mappingId: await mappingId() }),
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('GET /mappings/:mappingId/versions/:versionId', () => {
  it('answers 404 for a version of another Mapping', async () => {
    const mapping = await createdMapping()
    const version = await published(mapping.id)
    const other = await created('DESADV')

    const response = await admin.inject({ method: 'GET', url: versionUrl(other.id, version.id) })

    expect(response.statusCode).toBe(404)
  })

  it.each([
    ['an unknown version', unknownId],
    ['an id that is no uuid', 'not-a-uuid'],
  ])('answers 404 for %s', async (_, versionId) => {
    const mapping = await createdMapping()

    const response = await admin.inject({ method: 'GET', url: versionUrl(mapping.id, versionId) })

    expect(response.statusCode).toBe(404)
  })
})

describe('POST /mappings/:mappingId/versions/:versionId/restore', () => {
  it('copies an older version into the Draft and leaves every version unchanged', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const first = await published(mapping.id)
    await save(mapping.id, buyerGln)
    await published(mapping.id)
    const before = await versionsOf(mapping.id)

    const response = await restore(mapping.id, first.id)

    expect(response.statusCode).toBe(200)

    const restored = mappingDraftSchema.parse(response.json())

    expect(restored).toMatchObject({ ...orderNumber, latestVersion: 2, unpublishedChanges: true })
    expect(await draftOf(mapping.id)).toEqual(restored)
    expect(await versionsOf(mapping.id)).toEqual(before)
    expect(await versionOf(mapping.id, first.id)).toMatchObject(orderNumber)
  })

  it('leaves no unpublished changes after restoring the latest version', async () => {
    const mapping = await createdMapping()
    await save(mapping.id, orderNumber)
    const latest = await published(mapping.id)
    await save(mapping.id, buyerGln)

    const response = await restore(mapping.id, latest.id)

    expect(mappingDraftSchema.parse(response.json())).toMatchObject({
      ...orderNumber,
      unpublishedChanges: false,
    })
    expect((await publish(mapping.id, { changeNote: '' })).statusCode).toBe(409)
  })

  it('answers 404 and keeps the Draft for a version of another Mapping', async () => {
    const mapping = await createdMapping()
    const version = await published(mapping.id)
    const other = await created('DESADV')
    const before = await draftOf(other.id)

    expect((await restore(other.id, version.id)).statusCode).toBe(404)
    expect(await draftOf(other.id)).toEqual(before)
  })

  it.each([
    ['an unknown version', unknownId],
    ['an id that is no uuid', 'not-a-uuid'],
  ])('answers 404 for %s', async (_, versionId) => {
    const mapping = await createdMapping()

    expect((await restore(mapping.id, versionId)).statusCode).toBe(404)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const foreign = await createdMapping(otherAdmin)
    const version = await published(foreign.id, '', otherAdmin)

    expect((await restore(foreign.id, version.id)).statusCode).toBe(404)
  })
})

describe('GET /mapping-versions', () => {
  it('lists the published versions of the Workspace by Mapping name, newest first', async () => {
    const orders = await createdMapping()
    const first = await published(orders.id)
    await save(orders.id, buyerGln)
    const second = await published(orders.id)
    const despatch = await created('DESADV')
    const despatchVersion = await published(despatch.id)
    await published((await createdMapping(otherAdmin)).id, '', otherAdmin)

    const summary = ({
      id,
      mappingId,
      mappingName,
      version,
      publishedAt,
    }: MappingVersionEntry) => ({
      id,
      mappingId,
      mappingName,
      version,
      publishedAt,
    })

    expect(await publishedVersions()).toEqual([
      summary(despatchVersion),
      summary(second),
      summary(first),
    ])
    expect(await publishedVersions('DESADV')).toEqual([summary(despatchVersion)])
  })

  it('answers 400 for an unknown Message Type', async () => {
    const response = await admin.inject({
      method: 'GET',
      url: `${publishedMappingVersionsEndpoint.path}?messageType=IFTMIN`,
    })

    expect(response.statusCode).toBe(400)
  })
})
