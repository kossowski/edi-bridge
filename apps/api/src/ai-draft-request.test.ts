import { MockLanguageModelV4 } from 'ai/test'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  type AiDraftEvent,
  aiBudgetEndpoint,
  aiBudgetExhaustedProblemSchema,
  aiBudgetExhaustedStatus,
  aiBudgetSchema,
  aiReviewOpenStatus,
  createDocumentStructureEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  type MappingLink,
  mappingDraftEndpoint,
  mappingDraftSchema,
  mappingSummarySchema,
  parseAiDraftEvent,
  proposedAiReview,
  type RequestAiDraftBody,
  requestAiDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { aiTokenUsage, documentStructures, mappings, workspaces } from '@edi-bridge/db'

import { type Client, ownWorkspace, startTestApi, type TestApi } from './testing.js'

type Generate = MockLanguageModelV4['doGenerate']

let generate: Generate

let api: TestApi

const model = new MockLanguageModelV4({ doGenerate: (options) => generate(options) })

const logged: Array<{ msg?: string; err?: unknown }> = []

beforeAll(async () => {
  api = await startTestApi({
    aiModel: model,
    logger: {
      level: 'error',
      stream: { write: (line: string) => logged.push(JSON.parse(line)) },
    },
  })
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await api.connection.db.delete(mappings)
  await api.connection.db.delete(documentStructures)
  await api.connection.db.delete(aiTokenUsage)
  await api.connection.db
    .update(workspaces)
    .set({ aiDailyTokenLimit: 200_000 })
    .where(eq(workspaces.id, ownWorkspace.id))
})

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
}

const answer = (links: ReadonlyArray<MappingLink>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ links }) }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
})

const answering = (...answers: ReadonlyArray<ReturnType<typeof answer>>) => {
  const queue = [...answers]

  generate = () => {
    const next = queue.shift()

    return next
      ? Promise.resolve(next)
      : Promise.reject(new Error('The test model has no answer left'))
  }
}

const invoiceLinks: MappingLink[] = [
  { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
  { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
]

const createdInvoiceMapping = async () => {
  const structure = await api.admin.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name: 'ERP orders', origin: documentStructureOrigins.jsonDocument },
  })

  const mapping = await api.admin.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType: 'INVOIC' },
  })

  return {
    mappingId: mappingSummarySchema.parse(mapping.json()).id,
    sampleId: documentStructureSchema.parse(structure.json()).id,
  }
}

const requestDraft = (
  mappingId: string,
  body: Partial<RequestAiDraftBody>,
  client: Client = api.admin,
) =>
  client.inject({
    method: requestAiDraftEndpoint.method,
    url: toPath(requestAiDraftEndpoint.path, { id: mappingId }),
    headers: { accept: 'text/event-stream' },
    body,
  })

const eventsOf = (body: string): AiDraftEvent[] =>
  body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => {
      const event = parseAiDraftEvent(frame.slice('data:'.length))

      expect(event).not.toBeNull()

      // SAFETY: the assertion above fails the test for an event that does not parse.
      return event as AiDraftEvent
    })

const draftOf = async (mappingId: string) =>
  mappingDraftSchema.parse(
    (
      await api.admin.inject({
        method: 'GET',
        url: toPath(mappingDraftEndpoint.path, { id: mappingId }),
      })
    ).json(),
  )

const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })

// Destroying the raw response is how the client going away reaches the route.
const cancelledAfter = async (
  mappingId: string,
  body: RequestAiDraftBody,
  last: (event: AiDraftEvent) => boolean,
) => {
  const response = await api.admin.inject({
    method: requestAiDraftEndpoint.method,
    url: toPath(requestAiDraftEndpoint.path, { id: mappingId }),
    headers: { accept: 'text/event-stream' },
    body,
    payloadAsStream: true,
  })

  let received = ''

  for await (const chunk of response.stream()) {
    received += String(chunk)

    if (eventsOf(received).some(last)) {
      break
    }
  }

  response.raw.res.destroy()

  return eventsOf(received)
}

// The Admin saves the Draft while the model works on its answer.
const savingDuringRun = (
  mappingId: string,
  saved: ReadonlyArray<MappingLink>,
  proposed: ReadonlyArray<MappingLink>,
) => {
  generate = async () => {
    const response = await api.admin.inject({
      method: 'PUT',
      url: toPath(saveMappingDraftEndpoint.path, { id: mappingId }),
      body: { links: saved, transforms: [], transformLinks: [] },
    })

    expect(response.statusCode).toBe(200)

    return answer(proposed)
  }
}

const usedToday = async () =>
  aiBudgetSchema.parse(
    (await api.admin.inject({ method: 'GET', url: aiBudgetEndpoint.path })).json(),
  ).usedToday

describe('POST /mappings/:id/ai-draft', () => {
  it('streams the steps, then the checked links and the Draft that marks them', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    answering(answer(invoiceLinks))

    const response = await requestDraft(mappingId, { sampleId })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')

    const events = eventsOf(response.body)

    expect(events.slice(0, -1)).toEqual([
      { type: 'step', step: { kind: 'readingSample', round: 1 } },
      { type: 'step', step: { kind: 'linksDrafted', round: 1, linkCount: 4 } },
      { type: 'step', step: { kind: 'checkingAgainstSample', round: 1 } },
    ])

    const drafted = events.at(-1)

    expect(drafted).toMatchObject({
      type: 'drafted',
      proposal: { links: invoiceLinks, transforms: [], transformLinks: [] },
      draft: { links: invoiceLinks, unpublishedChanges: true, aiReview: { sampleId } },
    })
  })

  it('stores the Draft with its open AI review and records the tokens', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    answering(answer(invoiceLinks))

    const drafted = eventsOf((await requestDraft(mappingId, { sampleId })).body).at(-1)
    const stored = await draftOf(mappingId)

    expect(stored.links).toEqual(invoiceLinks)
    expect(stored.aiReview?.sampleId).toBe(sampleId)
    expect(drafted).toMatchObject({ draft: { aiReview: stored.aiReview } })
    expect(await usedToday()).toBe(120)
  })

  it('keeps the links the Draft had and adds the proposed ones', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    const saved = await api.admin.inject({
      method: 'PUT',
      url: toPath(saveMappingDraftEndpoint.path, { id: mappingId }),
      body: { links: invoiceLinks.slice(0, 1), transforms: [], transformLinks: [] },
    })

    expect(saved.statusCode).toBe(200)

    answering(answer(invoiceLinks.slice(1)))

    await requestDraft(mappingId, { sampleId })

    expect((await draftOf(mappingId)).links).toEqual(invoiceLinks)
  })

  it('reports a failed check without links, keeps the Draft and records the tokens', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    const broken = [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }]

    answering(answer(broken), answer(broken), answer(broken))

    const events = eventsOf((await requestDraft(mappingId, { sampleId })).body)

    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'checkFailed' })
    expect(events.some(({ type }) => type === 'drafted')).toBe(false)
    expect(await draftOf(mappingId)).toMatchObject({ links: [], aiReview: null })
    expect(await usedToday()).toBe(360)
  })

  it('reports an unavailable model provider', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    generate = () => Promise.reject(new Error('connect ECONNREFUSED'))

    const events = eventsOf((await requestDraft(mappingId, { sampleId })).body)

    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'unavailable' })
    expect(await draftOf(mappingId)).toMatchObject({ links: [], aiReview: null })
  })

  it('records the tokens of the finished steps when the client cancels the run', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    const broken = [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }]
    let calls = 0

    generate = (options) => {
      calls += 1

      return calls === 1 ? Promise.resolve(answer(broken)) : untilAborted(options.abortSignal)
    }

    const events = await cancelledAfter(
      mappingId,
      { sampleId },
      (event) => event.type === 'step' && event.step.kind === 'fixingErrors',
    )

    expect(events.at(-1)).toMatchObject({ type: 'step', step: { kind: 'fixingErrors' } })
    await expect.poll(usedToday).toBe(120)
    expect(await draftOf(mappingId)).toMatchObject({ links: [], aiReview: null })
  })

  it('adds the proposed links to a Draft the Admin saved during the run', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    const savedLink = { sourcePath: 'orderNumber', targetPath: 'SG1+ON/RFF+ON/C506/1154' }

    savingDuringRun(mappingId, [savedLink], invoiceLinks)

    const events = eventsOf((await requestDraft(mappingId, { sampleId })).body)

    expect(events.at(-1)).toMatchObject({
      type: 'drafted',
      draft: { links: [savedLink, ...invoiceLinks] },
    })
    expect((await draftOf(mappingId)).links).toEqual([savedLink, ...invoiceLinks])
  })

  it('keeps the link the Admin saved to a proposed target during the run', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    const savedLink = { sourcePath: 'orderDate', targetPath: 'BGM/1004' }
    const stored = invoiceLinks.slice(1)

    savingDuringRun(mappingId, [savedLink], invoiceLinks)

    const drafted = eventsOf((await requestDraft(mappingId, { sampleId })).body).at(-1)
    const draft = await draftOf(mappingId)

    expect(drafted).toMatchObject({
      type: 'drafted',
      proposal: { links: stored },
      draft: { links: [savedLink, ...stored] },
    })
    expect(draft.links).toEqual([savedLink, ...stored])
    expect(draft.aiReview).toEqual(
      proposedAiReview(sampleId, { links: stored, transforms: [], transformLinks: [] }),
    )
  })

  it('stores nothing when the Admin linked every proposed target during the run', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    const savedLinks = invoiceLinks.map((link) => ({ ...link, sourcePath: 'orderNumber' }))

    savingDuringRun(mappingId, savedLinks, invoiceLinks)

    const drafted = eventsOf((await requestDraft(mappingId, { sampleId })).body).at(-1)

    expect(drafted).toMatchObject({
      type: 'drafted',
      proposal: { links: [] },
      draft: { links: savedLinks, aiReview: null },
    })
    expect(await draftOf(mappingId)).toMatchObject({ links: savedLinks, aiReview: null })
  })

  it('fails the run and keeps the other review when an AI review opened during the run', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()
    let calls = 0
    let inner: AiDraftEvent | undefined

    generate = async () => {
      calls += 1

      if (calls === 1) {
        inner = eventsOf((await requestDraft(mappingId, { sampleId })).body).at(-1)
      }

      return answer(invoiceLinks)
    }

    const events = eventsOf((await requestDraft(mappingId, { sampleId })).body)

    expect(inner).toMatchObject({ type: 'drafted' })
    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'checkFailed' })

    const stored = await draftOf(mappingId)

    expect(stored.links).toEqual(invoiceLinks)
    expect(inner).toMatchObject({ draft: { aiReview: stored.aiReview } })
    expect(await usedToday()).toBe(240)
  })

  it('logs an unexpected error before it reports the model provider as unavailable', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    logged.length = 0

    generate = async () => {
      await api.connection.db.delete(mappings).where(eq(mappings.id, mappingId))

      return answer(invoiceLinks)
    }

    const events = eventsOf((await requestDraft(mappingId, { sampleId })).body)

    expect(events.at(-1)).toEqual({ type: 'failed', reason: 'unavailable' })
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'The AI draft failed unexpectedly', err: expect.anything() }),
    )
    expect(await usedToday()).toBe(120)
  })

  it('answers 423 while the AI review of the Draft is open', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    answering(answer(invoiceLinks))
    await requestDraft(mappingId, { sampleId })

    const response = await requestDraft(mappingId, { sampleId })

    expect(response.statusCode).toBe(aiReviewOpenStatus)
    expect(response.json()).toEqual({ message: 'The AI review of the Draft is still open.' })
  })

  it('answers 429 with the budget once the daily budget is used up', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    await api.connection.db
      .update(workspaces)
      .set({ aiDailyTokenLimit: 1000 })
      .where(eq(workspaces.id, ownWorkspace.id))

    await api.connection.db.insert(aiTokenUsage).values({
      workspaceId: ownWorkspace.id,
      day: new Date().toISOString().slice(0, 10),
      tokens: 1000,
    })

    const response = await requestDraft(mappingId, { sampleId })

    expect(response.statusCode).toBe(aiBudgetExhaustedStatus)
    expect(aiBudgetExhaustedProblemSchema.parse(response.json()).budget).toMatchObject({
      dailyLimit: 1000,
      usedToday: 1000,
    })
  })

  it('answers 403 to a Viewer', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    expect((await requestDraft(mappingId, { sampleId }, api.viewer)).statusCode).toBe(403)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const { mappingId, sampleId } = await createdInvoiceMapping()

    expect((await requestDraft(mappingId, { sampleId }, api.otherAdmin)).statusCode).toBe(404)
  })

  it('answers 404 for a sample the Mapping does not have', async () => {
    const { mappingId } = await createdInvoiceMapping()

    const response = await requestDraft(mappingId, {
      sampleId: '4f8c2d1a-6b3e-4a9f-8c7d-2e1b0a9f8e7d',
    })

    expect(response.statusCode).toBe(404)
  })

  it('answers 400 without a sample', async () => {
    const { mappingId } = await createdInvoiceMapping()

    expect((await requestDraft(mappingId, {})).statusCode).toBe(400)
  })
})
