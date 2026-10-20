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

  it('names a not-sent CONTRL before a pending one', () => {
    expect(verdictOf(orderLifecycleReferences.partial)).toMatchObject({
      status: 'needs-attention',
      reason: 'confirmationNotSent',
      messageType: 'ORDERS',
      direction: 'inbound',
      done: 0,
    })
  })

  it('names a sent document whose receipt confirmation was not tracked once all are done', () => {
    expect(verdictOf(orderLifecycleReferences.multiPartner, 'Hansemarkt GmbH')).toEqual({
      status: 'done',
      reason: 'confirmationNotTracked',
      messageType: 'DESADV',
      direction: 'outbound',
      done: 3,
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

  it('names the next document before an untracked receipt confirmation', () => {
    expect(
      orderVerdictOf(withDispatchAdvice((current) => ({ ...current!, acknowledgement: null }))),
    ).toMatchObject({ status: 'on-track', reason: 'nextDocument', messageType: 'INVOIC' })
  })

  it('calls a delivered dispatch advice without an Interchange done', () => {
    const { messages } = withDispatchAdvice(() => null)
    const invoic = full.messages.find(({ messageType }) => messageType === 'INVOIC')!

    expect(orderVerdictOf({ ...full, messages: [...messages, invoic] })).toMatchObject({
      status: 'done',
      reason: 'done',
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
