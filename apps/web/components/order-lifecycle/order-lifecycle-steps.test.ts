import { describe, expect, it } from 'vitest'

import type { AcknowledgementState, OrderLifecycleMessage } from '@edi-bridge/contracts'

import { acknowledgementCounts } from './order-lifecycle-steps'

function message(
  messageType: OrderLifecycleMessage['messageType'],
  receivedAt: string,
  id: string,
  acknowledgement?: AcknowledgementState | null,
): OrderLifecycleMessage {
  return {
    messageType,
    direction: messageType === 'ORDERS' ? 'inbound' : 'outbound',
    receivedAt,
    run: {
      id,
      status: 'delivered',
      failureStage: null,
      replacedBy: null,
      waitingForTradingPartnerSince: null,
    },
    interchange:
      acknowledgement === undefined
        ? null
        : {
            id: '00000000-0000-4000-8000-000000000000',
            controlReference: id,
            acknowledgement,
          },
  }
}

describe('acknowledgementCounts', () => {
  it('counts each Acknowledgement state in a fixed order and skips absent states', () => {
    expect(
      acknowledgementCounts([
        message('DESADV', '2026-10-01T10:00:00.000Z', 'a', 'overdue'),
        message('DESADV', '2026-10-02T10:00:00.000Z', 'b', 'accepted'),
        message('DESADV', '2026-10-03T10:00:00.000Z', 'c', 'accepted'),
        message('DESADV', '2026-10-04T10:00:00.000Z', 'd', null),
        message('DESADV', '2026-10-05T10:00:00.000Z', 'e'),
      ]),
    ).toEqual([
      { state: 'accepted', count: 2 },
      { state: 'overdue', count: 1 },
    ])
  })

  it('skips Messages whose Run was Reprocessed', () => {
    const superseded = message('DESADV', '2026-10-01T10:00:00.000Z', 'a', 'rejected')

    expect(
      acknowledgementCounts([
        { ...superseded, run: { ...superseded.run, replacedBy: { id: 'b' } } },
        message('DESADV', '2026-10-02T10:00:00.000Z', 'b', 'accepted'),
      ]),
    ).toEqual([{ state: 'accepted', count: 1 }])
  })
})
