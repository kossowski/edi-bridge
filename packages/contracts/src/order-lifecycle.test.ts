import { describe, expect, it } from 'vitest'

import {
  type AcknowledgementState,
  openMessageTypes,
  type OrderLifecycleMessage,
  type OrderLifecycleMessageType,
  orderLifecycleListQuerySchema,
  orderLifecycleMessageSchema,
  orderLifecycleStatusOf,
  toOrderLifecycleSummary,
} from './order-lifecycle'

import type { FailureStage } from './run'

let sequence = 0

type MessageOptions = {
  failed?: FailureStage
  status?: 'received' | 'processing' | 'duplicate'
  acknowledgement?: AcknowledgementState
  replacedBy?: OrderLifecycleMessage
  waitingSince?: string
}

function message(
  messageType: OrderLifecycleMessageType,
  options: MessageOptions = {},
): OrderLifecycleMessage {
  sequence += 1

  const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
  const direction = messageType === 'ORDERS' ? 'inbound' : 'outbound'
  const replacedBy = options.replacedBy ? { id: options.replacedBy.run.id } : null

  return {
    messageType,
    direction,
    receivedAt: new Date(Date.UTC(2026, 9, 1, sequence)).toISOString(),
    run: options.failed
      ? {
          id,
          status: 'failed',
          failureStage: options.failed,
          replacedBy,
          waitingForTradingPartnerSince: options.waitingSince ?? null,
        }
      : {
          id,
          status: options.status ?? 'delivered',
          failureStage: null,
          replacedBy,
          waitingForTradingPartnerSince: null,
        },
    interchange: options.failed
      ? null
      : {
          id,
          controlReference: String(sequence),
          acknowledgement:
            direction === 'outbound' ? (options.acknowledgement ?? 'accepted') : null,
          notSentReason: null,
        },
  }
}

describe('orderLifecycleStatusOf', () => {
  it('is done once ORDERS, DESADV and INVOIC are delivered and the sent ones accepted', () => {
    expect(orderLifecycleStatusOf([message('ORDERS'), message('DESADV'), message('INVOIC')])).toBe(
      'done',
    )
  })

  it('is on track while DESADV and INVOIC have not happened yet', () => {
    expect(orderLifecycleStatusOf([message('ORDERS')])).toBe('on-track')
  })

  it('is on track while a Run is still processing', () => {
    expect(
      orderLifecycleStatusOf([message('ORDERS'), message('DESADV', { status: 'processing' })]),
    ).toBe('on-track')
  })

  it('needs attention for a failed Run that nobody replaced', () => {
    expect(
      orderLifecycleStatusOf([message('ORDERS'), message('DESADV', { failed: 'mapping' })]),
    ).toBe('needs-attention')
  })

  it('counts a failed Run that was replaced by its replacement', () => {
    const replacing = message('DESADV')

    expect(
      orderLifecycleStatusOf([
        message('ORDERS'),
        message('DESADV', { failed: 'mapping', replacedBy: replacing }),
        replacing,
        message('INVOIC'),
      ]),
    ).toBe('done')
  })

  it('needs attention when the replacing Run failed too', () => {
    const replacing = message('DESADV', { failed: 'delivery' })

    expect(
      orderLifecycleStatusOf([
        message('ORDERS'),
        message('DESADV', { failed: 'mapping', replacedBy: replacing }),
        replacing,
      ]),
    ).toBe('needs-attention')
  })

  it.each<AcknowledgementState>(['rejected', 'overdue'])(
    'needs attention for a %s Acknowledgement',
    (acknowledgement) => {
      expect(
        orderLifecycleStatusOf([
          message('ORDERS'),
          message('DESADV', { acknowledgement }),
          message('INVOIC'),
        ]),
      ).toBe('needs-attention')
    },
  )

  it('waits for the partner while an Acknowledgement is pending', () => {
    expect(
      orderLifecycleStatusOf([
        message('ORDERS'),
        message('DESADV'),
        message('INVOIC', { acknowledgement: 'pending' }),
      ]),
    ).toBe('waiting-for-trading-partner')
  })

  it('waits for the partner while a failed Run is marked as waiting for the partner', () => {
    expect(
      orderLifecycleStatusOf([
        message('ORDERS', { failed: 'parse', waitingSince: '2026-10-02T09:00:00.000Z' }),
      ]),
    ).toBe('waiting-for-trading-partner')
  })

  it('needs attention before it waits for the partner', () => {
    expect(
      orderLifecycleStatusOf([
        message('ORDERS'),
        message('DESADV', { acknowledgement: 'pending' }),
        message('INVOIC', { acknowledgement: 'overdue' }),
      ]),
    ).toBe('needs-attention')
  })

  it('ignores a duplicate Run', () => {
    expect(
      orderLifecycleStatusOf([
        message('ORDERS'),
        message('ORDERS', { status: 'duplicate' }),
        message('DESADV'),
        message('INVOIC'),
      ]),
    ).toBe('done')
  })
})

describe('toOrderLifecycleSummary', () => {
  it('summarises the order with its status, time span and the state of each step', () => {
    const orders = message('ORDERS')
    const failed = message('DESADV', { failed: 'mapping' })
    const desadv = message('DESADV', { acknowledgement: 'pending' })

    expect(
      toOrderLifecycleSummary({
        businessReference: '4711',
        tradingPartner: {
          id: '00000001-0000-4000-8000-000000000001',
          name: 'Hansemarkt GmbH',
          acknowledgementTimeLimitHours: 24,
        },
        messages: [orders, failed, desadv],
      }),
    ).toEqual({
      businessReference: '4711',
      tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
      status: 'needs-attention',
      startedAt: orders.receivedAt,
      lastActivityAt: desadv.receivedAt,
      steps: [
        { messageType: 'ORDERS', state: 'done' },
        { messageType: 'DESADV', state: 'needs-attention' },
        { messageType: 'INVOIC', state: 'open' },
      ],
    })
  })

  it('shows a step in progress while its Run is still processing', () => {
    const summary = toOrderLifecycleSummary({
      businessReference: '4712',
      tradingPartner: {
        id: '00000001-0000-4000-8000-000000000001',
        name: 'Hansemarkt GmbH',
        acknowledgementTimeLimitHours: 24,
      },
      messages: [message('ORDERS', { status: 'received' })],
    })

    expect(summary.steps[0]).toEqual({ messageType: 'ORDERS', state: 'in-progress' })
  })
})

describe('orderLifecycleListQuerySchema', () => {
  it('filters by several statuses and pages like the other lists', () => {
    expect(
      orderLifecycleListQuerySchema.parse({ q: ' hanse ', status: ['done', 'on-track'] }),
    ).toEqual({ q: 'hanse', status: ['done', 'on-track'], page: 1, pageSize: 50 })
  })

  it('accepts a single status', () => {
    expect(orderLifecycleListQuerySchema.parse({ status: 'done' }).status).toEqual(['done'])
  })

  it('rejects an unknown status', () => {
    expect(orderLifecycleListQuerySchema.safeParse({ status: 'late' }).success).toBe(false)
  })
})

describe('openMessageTypes', () => {
  it('lists DESADV and INVOIC as open steps while only the ORDERS arrived', () => {
    expect(openMessageTypes([{ messageType: 'ORDERS' }])).toEqual(['DESADV', 'INVOIC'])
  })

  it('has no open step once ORDERS, DESADV and INVOIC happened', () => {
    expect(
      openMessageTypes([
        { messageType: 'ORDERS' },
        { messageType: 'DESADV' },
        { messageType: 'DESADV' },
        { messageType: 'INVOIC' },
      ]),
    ).toEqual([])
  })
})

describe('orderLifecycleMessageSchema', () => {
  it('keeps why the CONTRL to a received Interchange was not sent', () => {
    const orders = message('ORDERS')

    expect(
      orderLifecycleMessageSchema.parse({
        ...orders,
        interchange: { ...orders.interchange, notSentReason: 'ambiguousChannel' },
      }).interchange?.notSentReason,
    ).toBe('ambiguousChannel')
  })

  it('rejects an unknown not-sent reason', () => {
    const orders = message('ORDERS')

    expect(
      orderLifecycleMessageSchema.safeParse({
        ...orders,
        interchange: { ...orders.interchange, notSentReason: 'partnerAsleep' },
      }).success,
    ).toBe(false)
  })

  it('rejects a not-sent reason on a sent Interchange', () => {
    const desadv = message('DESADV')

    expect(
      orderLifecycleMessageSchema.safeParse({
        ...desadv,
        interchange: { ...desadv.interchange, notSentReason: 'noOutboundChannel' },
      }).success,
    ).toBe(false)
  })
})
