import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import { runDetailSchema } from '@edi-bridge/contracts'

import messagesDe from '../../messages/de.json'
import messagesEn from '../../messages/en.json'
import { partnerMessage } from './partner-message'

const partner = { id: '00000000-0000-4000-8000-000000000010', name: 'Spreewald Markt' }

const parsed = runDetailSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  receivedAt: '2026-10-08T07:42:13.000Z',
  tradingPartner: partner,
  messageType: 'ORDERS',
  direction: 'inbound',
  flow: { id: '00000000-0000-4000-8000-000000000020', name: 'Spreewald ORDERS' },
  manualSubmission: false,
  businessReference: '4711',
  interchange: {
    id: '00000000-0000-4000-8000-000000000030',
    controlReference: '000123',
    raw: "UNB+UNOC:3'",
  },
  status: 'failed',
  failureStage: 'validation',
  steps: [{ stage: 'receipt', status: 'succeeded', startedAt: null, finishedAt: null }],
  message: null,
  mappingVersion: null,
  replaces: null,
  replacedBy: null,
  error: {
    code: 'wrong-format',
    message:
      'Component 6060 (quantity) of QTY is "24 PCE", but its format n..15 allows only digits',
    position: { segment: 9, tag: 'QTY', element: 1, component: 2 },
    details: null,
  },
  problem: {
    reason: 'invalidContent',
    whoFixes: 'tradingPartner',
    fixTarget: null,
  },
  waitingForTradingPartnerSince: null,
  duplicateOf: null,
  documentDeletedAt: null,
  testIndicator: false,
})

if (parsed.status !== 'failed') {
  throw new Error('The test Run has to be failed')
}

const run = parsed

function translator(messages: typeof messagesEn) {
  const t = createTranslator({ locale: 'en', messages, namespace: 'Document.partnerMessage' })

  return (key: Parameters<typeof t>[0], values?: Record<string, string | number>) => t(key, values)
}

describe('partnerMessage', () => {
  it('names the partner, the document, the transmission and the error', () => {
    expect(partnerMessage(run, { t: translator(messagesEn), messageTypeName: 'purchase order' }))
      .toBe(`Hello Spreewald Markt,

we could not process your purchase order 4711 (ORDERS). It came in the transmission with the control reference 000123.

A value in it breaks the EDIFACT rules for this kind of document.

Technical detail: Component 6060 (quantity) of QTY is "24 PCE", but its format n..15 allows only digits (error code wrong-format, segment 9 (QTY), element 1, component 2).

Could you check the file and send a corrected version?

Thank you`)
  })

  it('leaves out what the document does not have', () => {
    const message = partnerMessage(
      {
        ...run,
        businessReference: null,
        interchange: null,
        error: { ...run.error, position: null },
      },
      { t: translator(messagesEn), messageTypeName: 'purchase order' },
    )

    expect(message).toContain('we could not process your purchase order (ORDERS).\n\n')
    expect(message).toContain(
      'Technical detail: Component 6060 (quantity) of QTY is "24 PCE", but its format n..15 allows only digits (error code wrong-format).',
    )
  })

  it('writes the message in German', () => {
    const message = partnerMessage(run, {
      t: translator(messagesDe),
      messageTypeName: 'Bestellung',
    })

    expect(message).toMatch(/^Hallo Spreewald Markt,\n\nwir konnten Ihren Beleg „Bestellung 4711“/)
    expect(message).toContain('Fehlercode wrong-format, Segment 9 (QTY), Element 1, Komponente 2')
    expect(message).toMatch(/Vielen Dank$/)
  })
})
