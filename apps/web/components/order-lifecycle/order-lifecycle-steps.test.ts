import { describe, expect, it } from 'vitest'

import type { AcknowledgementState, OrderLifecycleMessage } from '@edi-bridge/contracts'

import {
  acknowledgementCounts,
  latestMessageCount,
  orderLifecycleSteps,
  shownMessages,
} from './order-lifecycle-steps'

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
    run: { id, status: 'delivered', failureStage: null, replacedBy: null },
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

describe('orderLifecycleSteps', () => {
  it('orders the steps ORDERS, DESADV, INVOIC and their Messages by time', () => {
    const steps = orderLifecycleSteps([
      message('INVOIC', '2026-10-05T10:00:00.000Z', 'invoic'),
      message('DESADV', '2026-10-04T10:00:00.000Z', 'second-desadv'),
      message('ORDERS', '2026-10-01T10:00:00.000Z', 'orders'),
      message('DESADV', '2026-10-02T10:00:00.000Z', 'first-desadv'),
    ])

    expect(
      steps.map(({ messageType, messages }) => [messageType, messages.map(({ run }) => run.id)]),
    ).toEqual([
      ['ORDERS', ['orders']],
      ['DESADV', ['first-desadv', 'second-desadv']],
      ['INVOIC', ['invoic']],
    ])
  })

  it('keeps Message Types that have not happened yet as open steps', () => {
    const steps = orderLifecycleSteps([message('ORDERS', '2026-10-01T10:00:00.000Z', 'orders')])

    expect(steps.map(({ messageType, open, missing }) => [messageType, open, missing])).toEqual([
      ['ORDERS', false, false],
      ['DESADV', true, false],
      ['INVOIC', true, false],
    ])
  })

  it('marks a Message Type without Messages before a later step as not found, not open', () => {
    const steps = orderLifecycleSteps([message('DESADV', '2026-10-02T10:00:00.000Z', 'desadv')])

    expect(steps.map(({ messageType, open, missing }) => [messageType, open, missing])).toEqual([
      ['ORDERS', false, true],
      ['DESADV', false, false],
      ['INVOIC', true, false],
    ])
  })
})

describe('shownMessages', () => {
  const messages = Array.from({ length: latestMessageCount + 3 }, (_, index) => index)

  it('shows only the latest Messages while collapsed', () => {
    expect(shownMessages(messages, false)).toEqual(messages.slice(3))
  })

  it('shows every Message when expanded', () => {
    expect(shownMessages(messages, true)).toEqual(messages)
  })
})

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
})
