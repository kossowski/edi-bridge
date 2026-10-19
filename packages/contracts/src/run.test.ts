import { describe, expect, it } from 'vitest'

import { runDetailSchema, waitForTradingPartnerRunEndpoint, whoFixes } from './run'

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  receivedAt: '2026-10-01T08:00:00.000Z',
  tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  messageType: 'ORDERS',
  direction: 'inbound',
  flow: { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' },
  manualSubmission: false,
  businessReference: 'PO000001',
  interchange: null,
  steps: [{ stage: 'receipt', status: 'succeeded', startedAt: null, finishedAt: null }],
  message: null,
  mappingVersion: null,
  replaces: null,
  replacedBy: null,
} as const

const error = { code: 'segmentCountMismatch', message: 'UNT declares 9 segments.', position: null }

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
  it('leaves a Run without a Failure Stage to nobody', () => {
    expect(whoFixes({ failureStage: null, direction: 'inbound' })).toBeNull()
  })

  it('asks the Trading Partner to resend an inbound Run that could not be read or validated', () => {
    expect(whoFixes({ failureStage: 'parse', direction: 'inbound' })).toBe('tradingPartner')
    expect(whoFixes({ failureStage: 'validation', direction: 'inbound' })).toBe('tradingPartner')
  })

  it('leaves an outbound validation failure to the Workspace', () => {
    expect(whoFixes({ failureStage: 'validation', direction: 'outbound' })).toBe('you')
  })

  it('leaves a mapping failure to the Workspace in both directions', () => {
    expect(whoFixes({ failureStage: 'mapping', direction: 'inbound' })).toBe('you')
    expect(whoFixes({ failureStage: 'mapping', direction: 'outbound' })).toBe('you')
  })

  it('offers a retry for a delivery failure', () => {
    expect(whoFixes({ failureStage: 'delivery', direction: 'outbound' })).toBe('retry')
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
