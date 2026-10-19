import { MockLanguageModelV4 } from 'ai/test'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  type AiDraftStep,
  createDocumentStructureEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  type MappingLink,
  mappingSummarySchema,
} from '@edi-bridge/contracts'
import { documentStructures, mappings } from '@edi-bridge/db'

import { draftMapping } from './ai-draft.js'
import { Db } from './db.js'
import { AiDraftFailed } from './errors.js'
import { ownWorkspace, startTestApi, type TestApi } from './testing.js'
import { CurrentWorkspace } from './workspace.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await api.connection.db.delete(mappings)
  await api.connection.db.delete(documentStructures)
})

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

const invoiceLinks: MappingLink[] = [
  { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
  { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
]

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

const modelAnswering = (...answers: ReadonlyArray<ReturnType<typeof answer>>) =>
  new MockLanguageModelV4({ doGenerate: [...answers] })

const started = async (model: MockLanguageModelV4) => {
  const { mappingId, sampleId } = await createdInvoiceMapping()
  const steps: AiDraftStep[] = []

  const run = draftMapping({
    mappingId,
    sampleId,
    model,
    onStep: (step) => void steps.push(step),
  }).pipe(
    Effect.provideService(CurrentWorkspace, { id: ownWorkspace.id }),
    Effect.provideService(Db, api.connection.db),
  )

  return { run, steps }
}

const drafted = async (model: MockLanguageModelV4) => {
  const { run, steps } = await started(model)

  return { ...(await Effect.runPromise(run)), steps }
}

const failed = async (model: MockLanguageModelV4) => {
  const { run, steps } = await started(model)

  return { error: await Effect.runPromise(Effect.flip(run)), steps }
}

describe('draftMapping', () => {
  it('converts links that pass the check against the Sample Document into a proposal', async () => {
    const { proposal, tokens, steps } = await drafted(modelAnswering(answer(invoiceLinks)))

    expect(proposal).toEqual({ links: invoiceLinks, transforms: [], transformLinks: [] })
    expect(tokens).toBe(120)

    expect(steps).toEqual([
      { kind: 'readingSample', round: 1 },
      { kind: 'linksDrafted', round: 1, linkCount: 4 },
      { kind: 'checkingAgainstSample', round: 1 },
    ])
  })

  it('feeds the errors of the check back to the model and starts the next round', async () => {
    const withoutSupplier = invoiceLinks.filter(
      ({ targetPath }) => !targetPath.startsWith('SG2+SU'),
    )

    const model = modelAnswering(answer(withoutSupplier), answer(invoiceLinks))

    const { proposal, tokens, steps } = await drafted(model)

    expect(proposal.links).toEqual(invoiceLinks)
    expect(tokens).toBe(240)

    expect(steps).toEqual([
      { kind: 'readingSample', round: 1 },
      { kind: 'linksDrafted', round: 1, linkCount: 3 },
      { kind: 'checkingAgainstSample', round: 1 },
      { kind: 'fixingErrors', round: 1, errorCount: 1 },
      { kind: 'linksDrafted', round: 2, linkCount: 4 },
      { kind: 'checkingAgainstSample', round: 2 },
    ])

    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt.at(-1))).toContain(
      'SG2+SU/NAD+SU/C082/3039',
    )
  })

  it('fails the check after the last round', async () => {
    const broken = [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }]
    const model = modelAnswering(answer(broken), answer(broken), answer(broken))

    const { error, steps } = await failed(model)

    expect(error).toEqual(new AiDraftFailed({ reason: 'checkFailed', tokens: 360 }))
    expect(steps.at(-1)).toEqual({ kind: 'checkingAgainstSample', round: 3 })
    expect(model.doGenerateCalls).toHaveLength(3)
  })

  type ToolInput = { segmentTags: string[] } | { links: MappingLink[] }

  const toolCall = (toolName: string, input: ToolInput) => ({
    content: [
      { type: 'tool-call' as const, toolCallId: 'call-1', toolName, input: JSON.stringify(input) },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage,
    warnings: [],
  })

  const lastPrompt = (model: MockLanguageModelV4) =>
    JSON.stringify(model.doGenerateCalls.at(-1)?.prompt.at(-1))

  it('looks up segment definitions for the model', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [toolCall('lookUpSegments', { segmentTags: ['NAD'] }), answer(invoiceLinks)],
    })

    const { tokens, steps } = await drafted(model)

    expect(tokens).toBe(240)
    expect(steps).toContainEqual({ kind: 'lookingUpSegments', round: 1, segmentTags: ['NAD'] })
    expect(lastPrompt(model)).toContain('SG2+BY/NAD+BY/C082/3039')
    expect(lastPrompt(model)).toContain('Party identification')
  })

  it('runs links against the Sample Document for the model', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall('checkLinks', { links: [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }] }),
        answer(invoiceLinks),
      ],
    })

    const { proposal } = await drafted(model)

    expect(proposal.links).toEqual(invoiceLinks)
    expect(lastPrompt(model)).toContain('No value reaches the required target')
  })

  it('names unknown paths and targets linked twice without running the engine', async () => {
    const twice = [
      { sourcePath: 'buyer.city', targetPath: 'BGM/1004' },
      { sourcePath: 'buyer.missing', targetPath: 'BGM/9999' },
    ]

    const model = modelAnswering(answer([...invoiceLinks, ...twice]), answer(invoiceLinks))

    const { steps } = await drafted(model)

    expect(steps).toContainEqual({ kind: 'fixingErrors', round: 1, errorCount: 3 })
    expect(lastPrompt(model)).toContain('A target is linked at most once')
    expect(lastPrompt(model)).toContain('buyer.missing')
    expect(lastPrompt(model)).toContain('BGM/9999')
  })

  it('fails as unavailable when the model provider does not answer', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error('connect ECONNREFUSED')),
    })

    const { error, steps } = await failed(model)

    expect(error).toEqual(new AiDraftFailed({ reason: 'unavailable', tokens: 0 }))
    expect(steps).toEqual([{ kind: 'readingSample', round: 1 }])
  })

  it('feeds an answer that is no list of links back to the model', async () => {
    const unreadable = {
      ...answer([]),
      content: [{ type: 'text' as const, text: '{"links":[{"sourcePath":"orderNumber"}]}' }],
    }

    const model = modelAnswering(unreadable, answer(invoiceLinks))

    const { tokens, steps } = await drafted(model)

    expect(tokens).toBe(240)
    expect(steps).toContainEqual({ kind: 'fixingErrors', round: 1, errorCount: 1 })
    expect(lastPrompt(model)).toContain('no list of links')
  })
})
