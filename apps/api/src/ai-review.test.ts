import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  acceptAiDraftEndpoint,
  acceptAiProposedPartsEndpoint,
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

let viewer: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, viewer, otherAdmin } = api)
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

// Stores the outcome of an AI draft directly, so these tests need no model.
const openReview = async (id: string, aiReview = review) => {
  await connection.db.update(mappings).set({ aiReview }).where(eq(mappings.id, id))
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

const noGraph: MappingGraph = { links: [], transforms: [], transformLinks: [] }

const lastLinkMarks: AiReview = {
  sampleId,
  proposedLinks: ['buyer.gln'],
  proposedTransforms: [],
  proposedTransformLinks: [],
}

const editedLastLink: MappingGraph = {
  ...proposed,
  links: [proposed.links[0]!, { sourcePath: 'BGM/1004', targetPath: 'buyer.gln' }],
}

// Each save leaves no AI review mark, so it closes the review.
const closingSaves = [
  { closedBy: 'rejected every proposed part', marks: review, draft: noGraph },
  { closedBy: 'edited the last proposed part', marks: lastLinkMarks, draft: editedLastLink },
]

const unknownVersionId = '9c8b7a6d-5e4f-4d3c-8b2a-1f0e9d8c7b6a'

const restore = (mappingId: string, versionId: string) =>
  admin.inject({
    method: 'POST',
    url: toPath(restoreMappingVersionEndpoint.path, { mappingId, versionId }),
  })

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

  it.each(closingSaves)(
    'closes the AI review once the Admin $closedBy',
    async ({ marks, draft }) => {
      const id = await mappingWith(proposed)
      await openReview(id, marks)

      const response = await save(id, draft)

      expect(response.statusCode).toBe(200)
      expect(mappingDraftSchema.parse(response.json()).aiReview).toBeNull()
      expect((await draftOf(id)).aiReview).toBeNull()
    },
  )

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

  it.each(closingSaves)('publishes once the Admin $closedBy', async ({ marks, draft }) => {
    const id = await mappingWith(proposed)
    await openReview(id, marks)
    expect((await save(id, draft)).statusCode).toBe(200)

    expect((await publish(id)).statusCode).toBe(201)
  })
})

describe('POST /mappings/:mappingId/versions/:versionId/restore', () => {
  it('answers 423 and keeps the Draft while the AI review is open', async () => {
    const id = await mappingWith({ links: [], transforms: [], transformLinks: [] })
    expect((await publish(id)).statusCode).toBe(201)
    const [version] = await versionsOf(id)
    expect((await save(id, proposed)).statusCode).toBe(200)
    await openReview(id)

    const response = await restore(id, version!.id)

    expect(response.statusCode).toBe(aiReviewOpenStatus)
    expect(response.json()).toEqual(aiReviewOpenProblem)
    expect(await draftOf(id)).toMatchObject({ ...proposed, aiReview: review })
  })

  it.each(closingSaves)(
    'restores the version once the Admin $closedBy',
    async ({ marks, draft }) => {
      const id = await mappingWith(proposed)
      expect((await publish(id)).statusCode).toBe(201)
      const [version] = await versionsOf(id)
      await openReview(id, marks)
      expect((await save(id, draft)).statusCode).toBe(200)

      const response = await restore(id, version!.id)

      expect(response.statusCode).toBe(200)
      expect(mappingDraftSchema.parse(response.json())).toMatchObject({
        ...proposed,
        aiReview: null,
      })
    },
  )

  it('answers 404 for an unknown version while the AI review is open', async () => {
    const id = await draftedByAi()

    const response = await restore(id, unknownVersionId)

    expect(response.statusCode).toBe(404)
    expect(await draftOf(id)).toMatchObject({ ...proposed, aiReview: review })
  })
})

const accept = (id: string, target = admin) =>
  target.inject({ method: 'POST', url: toPath(acceptAiDraftEndpoint.path, { id }) })

const acceptParts = (id: string, body: NonNullable<InjectOptions['body']>, target = admin) =>
  target.inject({ method: 'POST', url: toPath(acceptAiProposedPartsEndpoint.path, { id }), body })

const noParts = { links: [], transforms: [], transformLinks: [] }

const noReviewProblem = { message: 'The Draft has no open AI review.' }

describe('POST /mappings/:id/ai-draft/accept', () => {
  it('closes the AI review, keeps the Draft and lets the Admin publish it', async () => {
    const id = await draftedByAi()

    const response = await accept(id)

    expect(response.statusCode).toBe(200)

    const accepted = mappingDraftSchema.parse(response.json())

    expect(accepted).toMatchObject({ ...proposed, aiReview: null })
    expect(await draftOf(id)).toEqual(accepted)
    expect((await publish(id)).statusCode).toBe(201)
  })

  it('answers 409 for a Draft without an open AI review', async () => {
    const id = await mappingWith(proposed)

    const response = await accept(id)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(noReviewProblem)
  })

  it('answers 403 to a Viewer and keeps the review open', async () => {
    const id = await draftedByAi()

    expect((await accept(id, viewer)).statusCode).toBe(403)
    expect((await draftOf(id)).aiReview).toEqual(review)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const id = await draftedByAi()

    expect((await accept(id, otherAdmin)).statusCode).toBe(404)
    expect((await draftOf(id)).aiReview).toEqual(review)
  })
})

describe('POST /mappings/:id/ai-draft/accept-parts', () => {
  it('drops the marks of the accepted parts and keeps the others', async () => {
    const id = await draftedByAi()

    const response = await acceptParts(id, {
      links: ['orderNumber'],
      transforms: [constantId],
      transformLinks: [],
    })

    expect(response.statusCode).toBe(200)

    const expected = {
      ...review,
      proposedLinks: ['buyer.gln'],
      proposedTransforms: [],
    }

    expect(mappingDraftSchema.parse(response.json()).aiReview).toEqual(expected)
    expect((await draftOf(id)).aiReview).toEqual(expected)
  })

  it('closes the review once no proposed link, transform or transform link is left', async () => {
    const id = await draftedByAi()

    const response = await acceptParts(id, {
      links: review.proposedLinks,
      transforms: review.proposedTransforms,
      transformLinks: review.proposedTransformLinks,
    })

    expect(response.statusCode).toBe(200)
    expect(mappingDraftSchema.parse(response.json()).aiReview).toBeNull()
    expect((await publish(id)).statusCode).toBe(201)
  })

  it('answers 409 and keeps every mark for a part the review does not mark', async () => {
    const id = await draftedByAi()

    const response = await acceptParts(id, { ...noParts, links: ['orderNumber', 'currency'] })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      message: 'The AI review does not mark every part to accept.',
    })
    expect((await draftOf(id)).aiReview).toEqual(review)
  })

  it('answers 409 for a Draft without an open AI review', async () => {
    const id = await mappingWith(proposed)

    const response = await acceptParts(id, { ...noParts, links: ['orderNumber'] })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(noReviewProblem)
  })

  it('answers 400 when it names no part', async () => {
    const id = await draftedByAi()

    expect((await acceptParts(id, noParts)).statusCode).toBe(400)
  })

  it('answers 403 to a Viewer and keeps every mark', async () => {
    const id = await draftedByAi()

    expect((await acceptParts(id, { ...noParts, links: ['orderNumber'] }, viewer)).statusCode).toBe(
      403,
    )
    expect((await draftOf(id)).aiReview).toEqual(review)
  })
})
