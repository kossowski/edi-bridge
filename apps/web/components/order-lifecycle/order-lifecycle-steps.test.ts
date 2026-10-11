import { describe, expect, it } from 'vitest'

import type { OrderLifecycleMessage } from '@edi-bridge/contracts'

import { orderLifecycleSteps } from './order-lifecycle-steps'

function message(
  messageType: OrderLifecycleMessage['messageType'],
  receivedAt: string,
  id: string,
): OrderLifecycleMessage {
  return {
    messageType,
    direction: messageType === 'ORDERS' ? 'inbound' : 'outbound',
    receivedAt,
    run: { id, status: 'delivered', failureStage: null, replacedBy: null },
    interchange: null,
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

    expect(steps.map(({ messageType, open }) => [messageType, open])).toEqual([
      ['ORDERS', false],
      ['DESADV', true],
      ['INVOIC', true],
    ])
  })
})
