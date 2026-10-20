import { describe, expect, it } from 'vitest'

import { orderLifecycleReferences, seedOrderLifecycles } from '@edi-bridge/mocks'

import type { OrderLifecycle, OrderLifecycleMessage } from '@edi-bridge/contracts'

import { orderVerdictOf, waitingTimeOf } from './order-verdict'

const { orderLifecycles } = seedOrderLifecycles(new Date('2026-10-12T12:00:00.000Z'))

function verdictOf(businessReference: string, tradingPartner?: string) {
  const lifecycle = orderLifecycles.find(
    (candidate) =>
      candidate.businessReference === businessReference &&
      (tradingPartner === undefined || candidate.tradingPartner.name === tradingPartner),
  )!

  const { status, reason, messageType, direction, done } = orderVerdictOf(lifecycle)

  return { status, reason, messageType, direction, done }
}

describe('orderVerdictOf', () => {
  it('calls a complete order done', () => {
    expect(verdictOf(orderLifecycleReferences.full)).toEqual({
      status: 'done',
      reason: 'done',
      messageType: null,
      direction: null,
      done: 3,
    })
  })

  it('names the next document of an order on track', () => {
    expect(verdictOf(orderLifecycleReferences.onTrack)).toMatchObject({
      status: 'on-track',
      reason: 'nextDocument',
      messageType: 'DESADV',
      done: 1,
    })
  })

  it('needs attention for a not-sent CONTRL while another one is pending', () => {
    expect(verdictOf(orderLifecycleReferences.partial)).toMatchObject({
      status: 'needs-attention',
      reason: 'confirmationPending',
      messageType: 'DESADV',
      done: 0,
    })
  })

  it('reports an overdue receipt confirmation', () => {
    expect(verdictOf(orderLifecycleReferences.multiPartner, 'Alpenfrisch Märkte AG')).toMatchObject(
      { status: 'needs-attention', reason: 'overdue', messageType: 'DESADV', done: 1 },
    )
  })

  it('puts a failed document before a rejected one and skips replaced Runs', () => {
    expect(verdictOf(orderLifecycleReferences.failures)).toMatchObject({
      status: 'needs-attention',
      reason: 'failed',
      messageType: 'INVOIC',
      direction: 'outbound',
      done: 1,
    })
  })

  it('waits for a resend from the Trading Partner', () => {
    expect(verdictOf(orderLifecycleReferences.waitingForTradingPartner)).toMatchObject({
      status: 'waiting-for-trading-partner',
      reason: 'resendAwaited',
      messageType: 'ORDERS',
      direction: 'inbound',
      done: 0,
    })
  })
})

describe('orderVerdictOf for a sent document without receipt confirmation', () => {
  const full = orderLifecycles.find(
    ({ businessReference }) => businessReference === orderLifecycleReferences.full,
  )!

  function withDispatchAdvice(
    interchange: (
      current: OrderLifecycleMessage['interchange'],
    ) => OrderLifecycleMessage['interchange'],
  ): OrderLifecycle {
    return {
      ...full,
      messages: full.messages
        .filter(({ messageType }) => messageType !== 'INVOIC')
        .map((message) =>
          message.messageType === 'DESADV'
            ? { ...message, interchange: interchange(message.interchange) }
            : message,
        ),
    }
  }

  it.each([
    ['without an Interchange', () => null],
    [
      'without an Acknowledgement',
      (current: OrderLifecycleMessage['interchange']) => ({ ...current!, acknowledgement: null }),
    ],
  ])('calls a delivered dispatch advice %s sent, not awaited', (_, interchange) => {
    expect(orderVerdictOf(withDispatchAdvice(interchange))).toMatchObject({
      status: 'on-track',
      reason: 'sentUnconfirmed',
      messageType: 'DESADV',
      direction: 'outbound',
    })
  })
})

describe('waitingTimeOf', () => {
  const now = new Date('2026-10-12T12:00:00.000Z')

  it('counts whole hours below two days', () => {
    expect(waitingTimeOf('2026-10-11T05:30:00.000Z', now)).toEqual({ unit: 'hours', value: 30 })
  })

  it('counts whole days from two days on', () => {
    expect(waitingTimeOf('2026-10-09T10:00:00.000Z', now)).toEqual({ unit: 'days', value: 3 })
  })

  it('never goes below zero', () => {
    expect(waitingTimeOf('2026-10-12T13:00:00.000Z', now)).toEqual({ unit: 'hours', value: 0 })
  })
})
