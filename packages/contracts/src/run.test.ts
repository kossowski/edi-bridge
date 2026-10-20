import { describe, expect, it } from 'vitest'

import {
  failureStages,
  runDetailSchema,
  runListQuerySchema,
  runSummarySchema,
  waitForTradingPartnerRunEndpoint,
  endWaitingForTradingPartnerRunEndpoint,
  whoFixes,
} from './run'

const summary = {
  id: '00000000-0000-4000-8000-000000000001',
  receivedAt: '2026-10-01T08:00:00.000Z',
  tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  messageType: 'ORDERS',
  direction: 'inbound',
  flow: { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' },
  manualSubmission: false,
  businessReference: 'PO000001',
  interchange: null,
} as const

const base = {
  ...summary,
  steps: [{ stage: 'receipt', status: 'succeeded', startedAt: null, finishedAt: null }],
  message: null,
  mappingVersion: null,
  replaces: null,
  replacedBy: null,
} as const

const error = {
  code: 'segmentCountMismatch',
  message: 'UNT declares 9 segments.',
  position: null,
  details: null,
}

const tradingPartnerProblem = {
  reason: 'unreadable',
  whoFixes: 'tradingPartner',
  fixTarget: {
    kind: 'tradingPartner',
    tradingPartnerId: base.tradingPartner.id,
    name: base.tradingPartner.name,
  },
} as const

const unreadable = {
  ...base,
  status: 'failed',
  failureStage: 'parse',
  error,
  problem: tradingPartnerProblem,
  waitingForTradingPartnerSince: null,
  duplicateOf: null,
} as const

describe('whoFixes', () => {
  const unreadableProblem = { reason: 'unreadable' } as const

  it('leaves a Run without a Failure Stage to nobody', () => {
    expect(whoFixes({ failureStage: null, direction: 'inbound', problem: null })).toBeNull()
  })

  it('asks the Trading Partner to resend an inbound Run that could not be read or validated', () => {
    for (const failureStage of ['parse', 'validation'] as const) {
      expect(whoFixes({ failureStage, direction: 'inbound', problem: unreadableProblem })).toBe(
        'tradingPartner',
      )
    }
  })

  it('leaves an outbound validation failure to the Workspace', () => {
    expect(
      whoFixes({
        failureStage: 'validation',
        direction: 'outbound',
        problem: { reason: 'invalidContent' },
      }),
    ).toBe('you')
  })

  it('leaves a mapping failure to the Workspace in both directions', () => {
    for (const direction of ['inbound', 'outbound'] as const) {
      expect(
        whoFixes({ failureStage: 'mapping', direction, problem: { reason: 'missingField' } }),
      ).toBe('you')
    }
  })

  it('offers a retry for a delivery failure', () => {
    expect(
      whoFixes({
        failureStage: 'delivery',
        direction: 'outbound',
        problem: { reason: 'unreachable' },
      }),
    ).toBe('retry')
  })

  it('offers trying again for a defect at every Failure Stage', () => {
    for (const failureStage of failureStages) {
      for (const direction of ['inbound', 'outbound'] as const) {
        expect(whoFixes({ failureStage, direction, problem: { reason: 'defect' } })).toBe('retry')
      }
    }
  })
})

describe('runSummarySchema', () => {
  it('carries the problem reason of a failed Run so a list row tells who fixes it', () => {
    const failed = {
      ...summary,
      status: 'failed',
      failureStage: 'parse',
      problem: { reason: 'defect' },
    }

    expect(runSummarySchema.parse(failed)).toEqual(failed)
    expect(whoFixes(runSummarySchema.parse(failed))).toBe('retry')
    expect(runSummarySchema.safeParse({ ...failed, problem: null }).success).toBe(false)
  })

  it('carries no problem on a Run that did not fail', () => {
    const delivered = { ...summary, status: 'delivered', failureStage: null, problem: null }

    expect(runSummarySchema.parse(delivered)).toEqual(delivered)
  })
})

describe('runDetailSchema', () => {
  it('explains a failed Run with who fixes it and where the fix happens', () => {
    const missingCode = {
      ...unreadable,
      failureStage: 'mapping',
      problem: {
        reason: 'missingCode',
        whoFixes: 'you',
        fixTarget: {
          kind: 'lookupTable',
          lookupTableId: '00000008-0000-4000-8000-000000000001',
          name: 'Units of measure',
          code: 'KRT',
        },
      },
    }

    expect(runDetailSchema.parse(missingCode)).toEqual(missingCode)
  })

  it('names the setup piece to complete when a delivery stops on an incomplete setup', () => {
    const incompleteSetup = {
      ...unreadable,
      direction: 'outbound',
      failureStage: 'delivery',
      problem: {
        reason: 'incompleteSetup',
        whoFixes: 'retry',
        fixTarget: { kind: 'workspaceGln', name: 'Nordwind Foods' },
      },
    }

    expect(runDetailSchema.parse(incompleteSetup)).toEqual(incompleteSetup)
  })

  it('records the HTTP status the receiving system answered on a delivery failure', () => {
    const rejected = {
      ...unreadable,
      direction: 'outbound',
      failureStage: 'delivery',
      error: {
        code: 'unexpectedResponse',
        message: 'The Channel answered unexpectedly',
        position: null,
        details: { kind: 'httpResponse', status: 422 },
      },
      problem: { reason: 'unreachable', whoFixes: 'retry', fixTarget: null },
    }

    expect(runDetailSchema.parse(rejected)).toEqual(rejected)
    expect(
      runDetailSchema.safeParse({
        ...rejected,
        error: { ...rejected.error, details: { kind: 'httpResponse', status: 42 } },
      }).success,
    ).toBe(false)
  })

  it('accepts trying again for a defect outside delivery', () => {
    const defect = {
      ...unreadable,
      error: { ...error, code: 'processingDefect' },
      problem: { reason: 'defect', whoFixes: 'retry', fixTarget: null },
    }

    expect(runDetailSchema.parse(defect)).toEqual(defect)
  })

  it('needs a problem on a failed Run', () => {
    expect(runDetailSchema.safeParse({ ...unreadable, problem: null }).success).toBe(false)
  })

  it('keeps the problem in line with who fixes the Failure Stage', () => {
    const delivery = { ...unreadable, failureStage: 'delivery' }

    expect(runDetailSchema.safeParse(delivery).success).toBe(false)
  })

  it('marks a Run as waiting for the Trading Partner only when the Trading Partner fixes it', () => {
    const waiting = { ...unreadable, waitingForTradingPartnerSince: '2026-10-02T09:00:00.000Z' }

    const retry = {
      ...waiting,
      failureStage: 'delivery',
      problem: { reason: 'unreachable', whoFixes: 'retry', fixTarget: null },
    }

    expect(runDetailSchema.safeParse(waiting).success).toBe(true)
    expect(runDetailSchema.safeParse(retry).success).toBe(false)
  })

  it('links a Duplicate to the original Run', () => {
    const original = { id: '00000000-0000-4000-8000-000000000002' }

    const duplicate = {
      ...base,
      status: 'duplicate',
      failureStage: null,
      error: null,
      problem: null,
      waitingForTradingPartnerSince: null,
      duplicateOf: original,
    }

    expect(runDetailSchema.parse(duplicate).duplicateOf).toEqual(original)
    expect(runDetailSchema.safeParse({ ...duplicate, status: 'delivered' }).success).toBe(false)
  })
})

describe('waitForTradingPartnerRunEndpoint', () => {
  it('marks a Run at its own path and answers with the Run detail', () => {
    expect(waitForTradingPartnerRunEndpoint).toMatchObject({
      method: 'POST',
      path: '/runs/:id/wait-for-trading-partner',
    })
  })
})

describe('endWaitingForTradingPartnerRunEndpoint', () => {
  it('ends the mark at the path of the mark and answers with the Run detail', () => {
    expect(endWaitingForTradingPartnerRunEndpoint).toMatchObject({
      method: 'DELETE',
      path: '/runs/:id/wait-for-trading-partner',
    })
  })
})

describe('runListQuerySchema mappingId', () => {
  it('states that a Run matches by the Mapping Version it recorded', () => {
    expect(runListQuerySchema.shape.mappingId.description).toMatch(/recorded/)
  })
})
