import { describe, expect, it } from 'vitest'

import {
  type ManualSubmissionInput,
  manualSubmissionInputSchema,
  manualSubmissionSchema,
  maxDocumentLength,
} from './manual-submission'

import type { RunSummary } from './run'

const input: ManualSubmissionInput = {
  channelId: '00000003-0000-4000-8000-000000000003',
  document: { fileName: 'orders.edi', content: "UNB+UNOC:3+4012345000016:14'" },
}

const run: RunSummary = {
  id: '6b0f1f0e-2a54-4d7c-9a51-0c6f1d2e3a40',
  receivedAt: '2026-10-09T08:15:00.000Z',
  tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  messageType: 'ORDERS',
  flow: { id: '00000002-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' },
  manualSubmission: true,
  status: 'delivered',
  failureStage: null,
}

describe('manualSubmissionInputSchema', () => {
  it('accepts an inbound Channel and a Document', () => {
    expect(manualSubmissionInputSchema.parse(input)).toEqual(input)
  })

  it('rejects an empty Document', () => {
    expect(
      manualSubmissionInputSchema.safeParse({
        ...input,
        document: { ...input.document, content: '' },
      }).success,
    ).toBe(false)
  })

  it('rejects a Document longer than the limit', () => {
    expect(
      manualSubmissionInputSchema.safeParse({
        ...input,
        document: { ...input.document, content: 'U'.repeat(maxDocumentLength + 1) },
      }).success,
    ).toBe(false)
  })

  it('trims the file name and rejects a blank one', () => {
    expect(
      manualSubmissionInputSchema.parse({
        ...input,
        document: { ...input.document, fileName: ' orders.edi ' },
      }).document.fileName,
    ).toBe('orders.edi')
    expect(
      manualSubmissionInputSchema.safeParse({
        ...input,
        document: { ...input.document, fileName: '  ' },
      }).success,
    ).toBe(false)
  })

  it('requires a Channel id', () => {
    expect(manualSubmissionInputSchema.safeParse({ ...input, channelId: 'inbox' }).success).toBe(
      false,
    )
  })
})

describe('manualSubmissionSchema', () => {
  it('accepts one Run per Message, each marked as manual', () => {
    const runs = [run, { ...run, id: '6b0f1f0e-2a54-4d7c-9a51-0c6f1d2e3a41' }]

    expect(manualSubmissionSchema.parse({ runs, notRouted: [] })).toEqual({ runs, notRouted: [] })
  })

  it('lists the Messages that no Flow routes by their raw Message Type', () => {
    const notRouted = [{ messageType: 'PRICAT' }]

    expect(manualSubmissionSchema.parse({ runs: [run], notRouted }).notRouted).toEqual(notRouted)
  })

  it('rejects a Run that is not marked as manual', () => {
    expect(
      manualSubmissionSchema.safeParse({
        runs: [{ ...run, manualSubmission: false }],
        notRouted: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a Manual Submission without a Run', () => {
    expect(
      manualSubmissionSchema.safeParse({ runs: [], notRouted: [{ messageType: 'PRICAT' }] })
        .success,
    ).toBe(false)
  })
})
