import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createDocumentStructureEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  mappingSummarySchema,
  requestAiDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'

import { startTestApi, type TestApi } from './testing.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

describe('POST /mappings/:id/ai-draft without a model', () => {
  it('streams that the model provider is unavailable', async () => {
    const structure = await api.admin.inject({
      method: 'POST',
      url: createDocumentStructureEndpoint.path,
      body: { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument },
    })

    const mapping = await api.admin.inject({
      method: 'POST',
      url: createMappingEndpoint.path,
      body: {
        messageType: 'INVOIC',
        documentStructureId: documentStructureSchema.parse(structure.json()).id,
      },
    })

    const response = await api.admin.inject({
      method: requestAiDraftEndpoint.method,
      url: toPath(requestAiDraftEndpoint.path, {
        id: mappingSummarySchema.parse(mapping.json()).id,
      }),
      headers: { accept: 'text/event-stream' },
      body: { sampleId: documentStructureSchema.parse(structure.json()).id },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe(
      `data:${JSON.stringify({ type: 'failed', reason: 'unavailable' })}\n\n`,
    )
  })
})
