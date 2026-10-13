import { describe, expect, it } from 'vitest'

import {
  acceptAiProposedPartsEndpoint,
  aiBudgetExhausted,
  aiBudgetExhaustedProblemSchema,
  aiDraftEventSchema,
  parseAiDraftEvent,
  requestAiDraftEndpoint,
} from './ai-draft'
import { mappingDraftSchema } from './mapping'

const sampleId = '00000008-0000-4000-8000-000000000001'

const draft = mappingDraftSchema.parse({
  mappingId: '00000007-0000-4000-8000-000000000001',
  name: 'Hansemarkt: ERP JSON to DESADV',
  direction: 'outbound',
  source: {
    kind: 'documentStructure',
    documentStructureId: '00000006-0000-4000-8000-000000000002',
    name: 'ERP dispatch advice',
  },
  target: { kind: 'messageType', messageType: 'DESADV' },
  links: [
    { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' },
    { sourcePath: 'documentDate', targetPath: 'DTM+137/C507/2380' },
  ],
  transforms: [],
  transformLinks: [],
  updatedAt: '2026-09-14T08:30:00.000Z',
  latestVersion: 2,
  unpublishedChanges: true,
  aiReview: {
    sampleId,
    proposedLinks: ['BGM/1004'],
    proposedTransforms: [],
    proposedTransformLinks: [],
  },
})

const proposal = {
  links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
  transforms: [],
  transformLinks: [],
}

describe('requestAiDraftEndpoint', () => {
  it('asks for an AI draft of a Mapping from one of its Sample Documents', () => {
    expect(requestAiDraftEndpoint.method).toBe('POST')
    expect(requestAiDraftEndpoint.body.parse({ sampleId })).toEqual({ sampleId })
    expect(requestAiDraftEndpoint.body.safeParse({}).success).toBe(false)
  })
})

describe('acceptAiProposedPartsEndpoint', () => {
  const transformId = '0000000a-0000-4000-8000-000000000001'

  it('accepts single AI-proposed parts by their review keys and returns the Draft', () => {
    const parts = {
      links: ['BGM/1004'],
      transforms: [transformId],
      transformLinks: [`input:${transformId}/value`],
    }

    expect(acceptAiProposedPartsEndpoint.method).toBe('POST')
    expect(acceptAiProposedPartsEndpoint.body.parse(parts)).toEqual(parts)
    expect(acceptAiProposedPartsEndpoint.response.parse(draft)).toEqual(draft)
  })

  it('rejects a request that accepts nothing', () => {
    expect(
      acceptAiProposedPartsEndpoint.body.safeParse({
        links: [],
        transforms: [],
        transformLinks: [],
      }).success,
    ).toBe(false)
  })
})

describe('parseAiDraftEvent', () => {
  it.each([
    { kind: 'readingSample', round: 1 },
    { kind: 'lookingUpSegments', round: 1, segmentTags: ['BGM', 'DTM'] },
    { kind: 'linksDrafted', round: 1, linkCount: 12 },
    { kind: 'checkingAgainstSample', round: 1 },
    { kind: 'fixingErrors', round: 1, errorCount: 2 },
  ])('reads the progress step $kind', (step) => {
    expect(parseAiDraftEvent(JSON.stringify({ type: 'step', step }))).toEqual({
      type: 'step',
      step,
    })
  })

  it('reads the checked proposal together with the Draft it went into', () => {
    const event = { type: 'drafted', proposal, draft }

    expect(parseAiDraftEvent(JSON.stringify(event))).toEqual(event)
  })

  it('reads a proposal without any links', () => {
    const empty = { links: [], transforms: [], transformLinks: [] }
    const event = { type: 'drafted', proposal: empty, draft: { ...draft, aiReview: null } }

    expect(parseAiDraftEvent(JSON.stringify(event))).toEqual(event)
  })

  it('rejects a proposal whose parts the Draft does not mark as AI-proposed', () => {
    const unmarked = { type: 'drafted', proposal, draft: { ...draft, aiReview: null } }

    expect(aiDraftEventSchema.safeParse(unmarked).success).toBe(false)
  })

  it.each(['checkFailed', 'budgetExhausted', 'unavailable'])(
    'reads a run that failed with %s',
    (reason) => {
      expect(parseAiDraftEvent(JSON.stringify({ type: 'failed', reason }))).toEqual({
        type: 'failed',
        reason,
      })
    },
  )

  it.each([
    ['data that is not JSON', 'step'],
    ['an event type this client does not know yet', JSON.stringify({ type: 'thinking' })],
    ['a step without its round', JSON.stringify({ type: 'step', step: { kind: 'readingSample' } })],
  ])('skips %s', (_, data) => {
    expect(parseAiDraftEvent(data)).toBeNull()
  })
})

describe('aiBudgetExhausted', () => {
  const resetsAt = '2026-10-12T00:00:00.000Z'

  it('tells a budget with tokens left today', () => {
    expect(aiBudgetExhausted({ dailyLimit: 200_000, usedToday: 199_999, resetsAt })).toBe(false)
  })

  it('tells a budget used up today', () => {
    expect(aiBudgetExhausted({ dailyLimit: 200_000, usedToday: 200_000, resetsAt })).toBe(true)
  })

  it('tells a Workspace without any budget as used up', () => {
    expect(aiBudgetExhausted({ dailyLimit: 0, usedToday: 0, resetsAt })).toBe(true)
  })
})

describe('aiBudgetExhaustedProblemSchema', () => {
  it('carries the budget, so the rejection can say when it resets', () => {
    const problem = {
      code: 'aiBudgetExhausted',
      message: 'The daily AI budget is used up.',
      budget: { dailyLimit: 200_000, usedToday: 200_000, resetsAt: '2026-10-12T00:00:00.000Z' },
    }

    expect(aiBudgetExhaustedProblemSchema.parse(problem)).toEqual(problem)
  })
})
