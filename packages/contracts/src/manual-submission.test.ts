import { describe, expect, it } from 'vitest'

import { encodeBase64 } from './document-structure-inference'
import {
  documentUndecodableProblem,
  documentUndecodableProblemSchema,
  type ManualSubmissionInput,
  manualSubmissionInputSchema,
  manualSubmissionSchema,
  maxDocumentBytes,
} from './manual-submission'

import type { RunSummary } from './run'

const input: ManualSubmissionInput = {
  channelId: '00000003-0000-4000-8000-000000000003',
  document: {
    fileName: 'orders.edi',
    content: btoa("UNB+UNOC:3+4012345000016:14'"),
    encoding: 'windows-1252',
  },
}

const withDocument = (document: Record<string, string>) => ({
  ...input,
  document: { ...input.document, ...document },
})

const run: RunSummary = {
  id: '6b0f1f0e-2a54-4d7c-9a51-0c6f1d2e3a40',
  receivedAt: '2026-10-09T08:15:00.000Z',
  tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  messageType: 'ORDERS',
  direction: 'inbound',
  flow: { id: '00000002-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' },
  manualSubmission: true,
  businessReference: 'PO000001',
  interchange: null,
  status: 'delivered',
  failureStage: null,
  problem: null,
}

describe('manualSubmissionInputSchema', () => {
  it('accepts an inbound Channel and a Document', () => {
    expect(manualSubmissionInputSchema.parse(input)).toEqual(input)
  })

  it.each(['utf-8', 'windows-1252'])('accepts the encoding %s', (encoding) => {
    expect(manualSubmissionInputSchema.safeParse(withDocument({ encoding })).success).toBe(true)
  })

  it.each(['latin1', 'iso-8859-1', 'utf-16le', ''])('rejects the encoding "%s"', (encoding) => {
    expect(manualSubmissionInputSchema.safeParse(withDocument({ encoding })).success).toBe(false)
  })

  it('accepts a Document without an encoding', () => {
    const { fileName, content } = input.document

    expect(
      manualSubmissionInputSchema.safeParse({ ...input, document: { fileName, content } }).success,
    ).toBe(true)
  })

  it('rejects content that is not base64', () => {
    expect(
      manualSubmissionInputSchema.safeParse(withDocument({ content: "UNB+UNOC:3'" })).success,
    ).toBe(false)
  })

  it('rejects an empty Document', () => {
    expect(manualSubmissionInputSchema.safeParse(withDocument({ content: '' })).success).toBe(false)
  })

  it('accepts a Document of the maximum size and rejects one byte more', () => {
    const ofBytes = (length: number) => encodeBase64(new Uint8Array(length).fill(0x55))

    expect(
      manualSubmissionInputSchema.safeParse(withDocument({ content: ofBytes(maxDocumentBytes) }))
        .success,
    ).toBe(true)
    expect(
      manualSubmissionInputSchema.safeParse(
        withDocument({ content: ofBytes(maxDocumentBytes + 1) }),
      ).success,
    ).toBe(false)
  })

  it('trims the file name and rejects a blank one', () => {
    expect(
      manualSubmissionInputSchema.parse(withDocument({ fileName: ' orders.edi ' })).document
        .fileName,
    ).toBe('orders.edi')
    expect(manualSubmissionInputSchema.safeParse(withDocument({ fileName: '  ' })).success).toBe(
      false,
    )
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

describe('documentUndecodableProblem', () => {
  it('suggests another encoding when the submitted encoding decided', () => {
    const problem = documentUndecodableProblem('Byte 12 (0xFC) is not valid UTF-8', 'utf-8')

    expect(documentUndecodableProblemSchema.parse(problem)).toEqual({
      code: 'documentUndecodable',
      encoding: 'utf-8',
      message:
        'Byte 12 (0xFC) is not valid UTF-8. Choose another encoding, such as Windows-1252 for a typical German CSV.',
      reason: 'Byte 12 (0xFC) is not valid UTF-8',
    })
  })

  it('suggests no encoding when the Interchange names its character set', () => {
    const problem = documentUndecodableProblem(
      'Byte 40 (0xFC) is not valid in UNOA (ASCII), at segment 2 (UNH)',
      null,
    )

    expect(documentUndecodableProblemSchema.parse(problem)).toEqual({
      code: 'documentUndecodable',
      encoding: null,
      message: 'Byte 40 (0xFC) is not valid in UNOA (ASCII), at segment 2 (UNH).',
      reason: 'Byte 40 (0xFC) is not valid in UNOA (ASCII), at segment 2 (UNH)',
    })
  })
})
