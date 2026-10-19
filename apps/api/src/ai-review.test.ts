import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  type AiReview,
  aiReviewOpenStatus,
  createDocumentStructureEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  mappingDraftEndpoint,
  mappingDraftSchema,
  type MappingGraph,
  mappingSummarySchema,
  mappingVersionEntrySchema,
  mappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  restoreMappingVersionEndpoint,
  saveMappingDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { type Connection, documentStructures, mappings } from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let connection: Connection

let admin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(mappings)
  await connection.db.delete(documentStructures)
})

const sampleId = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c'

const constantId = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

const proposed: MappingGraph = {
  links: [
    { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
    { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' },
  ],
  transforms: [
    { id: constantId, kind: 'constant', position: { x: 320, y: 80 }, config: { value: 'X' } },
  ],
  transformLinks: [
    {
      from: { kind: 'transform', transformId: constantId, output: 'value' },
      to: { kind: 'target', path: 'currency' },
    },
  ],
}

const review: AiReview = {
  sampleId,
  proposedLinks: ['orderNumber', 'buyer.gln'],
  proposedTransforms: [constantId],
  proposedTransformLinks: ['target:currency'],
}

const draftUrl = (id: string) => toPath(mappingDraftEndpoint.path, { id })

const draftOf = async (id: string, target = admin) => {
  const response = await target.inject({ method: 'GET', url: draftUrl(id) })

  expect(response.statusCode).toBe(200)

  return mappingDraftSchema.parse(response.json())
}

const save = (id: string, body: NonNullable<InjectOptions['body']>, target = admin) =>
  target.inject({ method: 'PUT', url: toPath(saveMappingDraftEndpoint.path, { id }), body })

const mappingWith = async (graph: MappingGraph) => {
  const structure = await admin.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument },
  })

  expect(structure.statusCode).toBe(201)

  const response = await admin.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType: 'ORDERS' },
  })

  expect(response.statusCode).toBe(201)

  const { id } = mappingSummarySchema.parse(response.json())

  expect((await save(id, graph)).statusCode).toBe(200)

  return id
}

// Drafting with the AI comes with a later route; until then the test stores its outcome directly.
const openReview = async (id: string) => {
  await connection.db.update(mappings).set({ aiReview: review }).where(eq(mappings.id, id))
}

const draftedByAi = async () => {
  const id = await mappingWith(proposed)

  await openReview(id)

  return id
}

const publish = (mappingId: string) =>
  admin.inject({
    method: 'POST',
    url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
    body: { changeNote: 'Drafted by the AI' },
  })

const versionsOf = async (mappingId: string) => {
  const response = await admin.inject({
    method: 'GET',
    url: toPath(mappingVersionsEndpoint.path, { mappingId }),
  })

  expect(response.statusCode).toBe(200)

  return mappingVersionEntrySchema.array().parse(response.json())
}

const aiReviewOpenProblem = { message: 'The AI review of the Draft is still open.' }

describe('GET /mappings/:id/draft', () => {
  it('serves the open AI review of the Draft', async () => {
    const id = await draftedByAi()

    expect((await draftOf(id)).aiReview).toEqual(review)
  })
})

describe('PUT /mappings/:id/draft', () => {
  it('drops the marks of the parts the Admin rejected or edited', async () => {
    const id = await draftedByAi()

    const response = await save(id, {
      links: [
        { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
        { sourcePath: 'BGM/1004', targetPath: 'buyer.gln' },
      ],
      transforms: [],
      transformLinks: [],
    })

    expect(response.statusCode).toBe(200)

    const expected = {
      sampleId,
      proposedLinks: ['orderNumber'],
      proposedTransforms: [],
      proposedTransformLinks: [],
    }

    expect(mappingDraftSchema.parse(response.json()).aiReview).toEqual(expected)
    expect((await draftOf(id)).aiReview).toEqual(expected)
  })

  it('keeps the marks of a transform the Admin only moved', async () => {
    const id = await draftedByAi()

    const moved = {
      ...proposed,
      transforms: proposed.transforms.map((transform) => ({
        ...transform,
        position: { x: 0, y: 0 },
      })),
    }

    expect((await save(id, moved)).statusCode).toBe(200)
    expect((await draftOf(id)).aiReview).toEqual(review)
  })
})

describe('POST /mappings/:mappingId/versions', () => {
  it('answers 423 and publishes nothing while the AI review is open', async () => {
    const id = await draftedByAi()

    const response = await publish(id)

    expect(response.statusCode).toBe(aiReviewOpenStatus)
    expect(response.json()).toEqual(aiReviewOpenProblem)
    expect(await versionsOf(id)).toEqual([])
  })
})

describe('POST /mappings/:mappingId/versions/:versionId/restore', () => {
  it('answers 423 and keeps the Draft while the AI review is open', async () => {
    const id = await mappingWith({ links: [], transforms: [], transformLinks: [] })
    expect((await publish(id)).statusCode).toBe(201)
    const [version] = await versionsOf(id)
    expect((await save(id, proposed)).statusCode).toBe(200)
    await openReview(id)

    const response = await admin.inject({
      method: 'POST',
      url: toPath(restoreMappingVersionEndpoint.path, { mappingId: id, versionId: version!.id }),
    })

    expect(response.statusCode).toBe(aiReviewOpenStatus)
    expect(response.json()).toEqual(aiReviewOpenProblem)
    expect(await draftOf(id)).toMatchObject({ ...proposed, aiReview: review })
  })
})
