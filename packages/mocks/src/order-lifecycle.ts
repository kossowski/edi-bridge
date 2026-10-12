import { delay, http, HttpResponse } from 'msw'

import {
  type AcknowledgementState,
  directionOf,
  type FailureStage,
  fromSearchParams,
  type OrderLifecycle,
  type OrderLifecycleInterchange,
  orderLifecycleMessageSchema,
  type OrderLifecycleMessageType,
  orderLifecycleSchema,
  orderLifecyclesEndpoint,
  type RunSummary,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { seedFlows } from './flow'
import { hour, overdueSinceOf } from './overdue'
import { badRequest, serverError } from './responses'
import { toRunSummary } from './run'
import { createRunStore, type Reprocessed } from './run-store'
import { stableUuid } from './seed-id'
import { seedTradingPartners } from './trading-partner'

export const orderLifecycleReferences = {
  full: '4711',
  partial: '4712',
  multiPartner: '4713',
  failures: '4714',
  largeVolume: '4715',
  noMatch: '0000',
  serverError: '5000',
} as const

type AcknowledgementOutcome = Extract<AcknowledgementState, 'accepted' | 'rejected'>

type MessageSeed = {
  messageType: OrderLifecycleMessageType
  hoursAgo: number
  outcome: 'delivered' | FailureStage
  acknowledgement?: AcknowledgementOutcome | undefined
  reprocessed?: { hoursAgo: number; acknowledgement: AcknowledgementOutcome }
}

type LifecycleSeed = {
  businessReference: string
  tradingPartner: string
  messages: MessageSeed[]
}

const deliveryCount = 30

function partDeliveries(): MessageSeed[] {
  return Array.from({ length: deliveryCount }, (_, delivery): MessageSeed[] => {
    const hoursAgo = (deliveryCount - delivery) * 24 - 2
    const latest = delivery === deliveryCount - 1

    const desadv: MessageSeed =
      delivery % 7 === 3
        ? {
            messageType: 'DESADV',
            hoursAgo,
            outcome: 'mapping',
            reprocessed: { hoursAgo: hoursAgo - 3, acknowledgement: 'accepted' },
          }
        : {
            messageType: 'DESADV',
            hoursAgo,
            outcome: 'delivered',
            acknowledgement: latest || delivery % 11 === 5 ? undefined : 'accepted',
          }

    const invoic: MessageSeed = {
      messageType: 'INVOIC',
      hoursAgo: hoursAgo - 6,
      outcome: 'delivered',
      acknowledgement: latest ? undefined : delivery % 9 === 4 ? 'rejected' : 'accepted',
    }

    return [desadv, invoic]
  }).flat()
}

const lifecycleSeeds: LifecycleSeed[] = [
  {
    businessReference: orderLifecycleReferences.full,
    tradingPartner: 'Hansemarkt GmbH',
    messages: [
      { messageType: 'ORDERS', hoursAgo: 6 * 24, outcome: 'delivered' },
      {
        messageType: 'DESADV',
        hoursAgo: 5 * 24,
        outcome: 'delivered',
        acknowledgement: 'accepted',
      },
      {
        messageType: 'INVOIC',
        hoursAgo: 4 * 24,
        outcome: 'delivered',
        acknowledgement: 'accepted',
      },
    ],
  },
  {
    businessReference: orderLifecycleReferences.partial,
    tradingPartner: 'Rheinkauf eG',
    messages: [
      { messageType: 'ORDERS', hoursAgo: 30, outcome: 'delivered' },
      { messageType: 'DESADV', hoursAgo: 3, outcome: 'delivered' },
    ],
  },
  {
    businessReference: orderLifecycleReferences.multiPartner,
    tradingPartner: 'Hansemarkt GmbH',
    messages: [
      { messageType: 'ORDERS', hoursAgo: 9 * 24, outcome: 'delivered' },
      {
        messageType: 'DESADV',
        hoursAgo: 8 * 24,
        outcome: 'delivered',
        acknowledgement: 'accepted',
      },
      {
        messageType: 'INVOIC',
        hoursAgo: 7 * 24,
        outcome: 'delivered',
        acknowledgement: 'accepted',
      },
    ],
  },
  {
    businessReference: orderLifecycleReferences.multiPartner,
    tradingPartner: 'Alpenfrisch Märkte AG',
    messages: [
      { messageType: 'ORDERS', hoursAgo: 26, outcome: 'delivered' },
      { messageType: 'DESADV', hoursAgo: 10, outcome: 'delivered' },
    ],
  },
  {
    businessReference: orderLifecycleReferences.failures,
    tradingPartner: 'Elbtal Warenhaus KG',
    messages: [
      { messageType: 'ORDERS', hoursAgo: 5 * 24, outcome: 'delivered' },
      {
        messageType: 'DESADV',
        hoursAgo: 4 * 24,
        outcome: 'mapping',
        reprocessed: { hoursAgo: 3 * 24, acknowledgement: 'rejected' },
      },
      { messageType: 'INVOIC', hoursAgo: 2 * 24, outcome: 'delivery' },
    ],
  },
  {
    businessReference: orderLifecycleReferences.largeVolume,
    tradingPartner: 'Hansemarkt GmbH',
    messages: [
      { messageType: 'ORDERS', hoursAgo: (deliveryCount + 1) * 24, outcome: 'delivered' },
      ...partDeliveries(),
    ],
  },
]

export type OrderLifecycleSeed = {
  runs: RunSummary[]
  reprocessed: Reprocessed[]
  orderLifecycles: OrderLifecycle[]
}

function interchangeOf(
  run: RunSummary,
  acknowledgement: AcknowledgementOutcome | undefined,
  tradingPartner: TradingPartner,
  now: Date,
): OrderLifecycleInterchange | null {
  if (run.interchange === null) {
    return null
  }

  const sent = directionOf(run) === 'outbound' && run.status === 'delivered'
  const overdueSince = overdueSinceOf(run.receivedAt, tradingPartner)

  return {
    ...run.interchange,
    acknowledgement: sent
      ? (acknowledgement ?? (overdueSince <= now.getTime() ? 'overdue' : 'pending'))
      : null,
  }
}

type MessageEntry = {
  runId: string
  acknowledgement: AcknowledgementOutcome | undefined
  replacedBy: RunSummary | null
}

export function seedOrderLifecycles(now = new Date()): OrderLifecycleSeed {
  const runs: RunSummary[] = []
  const reprocessed: Reprocessed[] = []

  const seeded = lifecycleSeeds.map(({ businessReference, messages, ...seed }) => {
    const tradingPartner = seedTradingPartners.find(({ name }) => name === seed.tradingPartner)!
    const tradingPartnerSummary = { id: tradingPartner.id, name: tradingPartner.name }

    function toRun(
      key: string,
      { messageType, hoursAgo, outcome }: Pick<MessageSeed, 'messageType' | 'hoursAgo' | 'outcome'>,
    ) {
      const flow = seedFlows.find(
        (candidate) =>
          candidate.tradingPartnerId === tradingPartner.id && candidate.messageType === messageType,
      )!

      const base = {
        id: stableUuid(`order-lifecycle:${businessReference}:${tradingPartnerSummary.id}:${key}`),
        // The seconds keep two inbound Runs from sharing an Interchange.
        receivedAt: new Date(now.getTime() - hoursAgo * hour - runs.length * 1000).toISOString(),
        tradingPartner: tradingPartnerSummary,
        messageType,
        flow: { id: flow.id, name: flow.name },
        manualSubmission: false,
      }

      const run = toRunSummary(
        outcome === 'delivered'
          ? { ...base, businessReference, status: 'delivered', failureStage: null }
          : { ...base, businessReference, status: 'failed', failureStage: outcome },
      )

      runs.push(run)

      return run
    }

    const entries = messages.flatMap((message, index): MessageEntry[] => {
      const run = toRun(String(index), message)

      if (!message.reprocessed) {
        return [{ runId: run.id, acknowledgement: message.acknowledgement, replacedBy: null }]
      }

      const replacing = toRun(`${index}:reprocessed`, {
        ...message,
        ...message.reprocessed,
        outcome: 'delivered',
      })

      reprocessed.push({ replaced: run.id, replacing: replacing.id })

      return [
        { runId: run.id, acknowledgement: undefined, replacedBy: replacing },
        {
          runId: replacing.id,
          acknowledgement: message.reprocessed.acknowledgement,
          replacedBy: null,
        },
      ]
    })

    return { businessReference, tradingPartner, entries }
  })

  const store = createRunStore(runs, reprocessed)

  const orderLifecycles = seeded.map(({ businessReference, tradingPartner, entries }) => {
    const toMessage = ({ runId, acknowledgement, replacedBy }: MessageEntry) => {
      const run = store.get(runId)!

      return orderLifecycleMessageSchema.parse({
        messageType: run.messageType,
        direction: directionOf(run),
        receivedAt: run.receivedAt,
        run: {
          id: run.id,
          status: run.status,
          failureStage: run.failureStage,
          replacedBy: replacedBy && { id: replacedBy.id },
        },
        interchange: interchangeOf(run, acknowledgement, tradingPartner, now),
      })
    }

    return orderLifecycleSchema.parse({
      businessReference,
      tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
      messages: entries
        .map(toMessage)
        .toSorted((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)),
    })
  })

  return { runs, reprocessed, orderLifecycles }
}

export type OrderLifecycleState = 'loading' | 'error'

export function orderLifecycleHandler(
  apiUrl: string,
  source?: ReadonlyArray<OrderLifecycle> | OrderLifecycleState,
) {
  const path = `${apiUrl}${orderLifecyclesEndpoint.path}`

  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  let orderLifecycles: ReadonlyArray<OrderLifecycle> | undefined

  return http.get(path, ({ request }) => {
    orderLifecycles ??= source ?? seedOrderLifecycles().orderLifecycles

    const query = orderLifecyclesEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    if (!query.success) {
      return badRequest(query.error.message)
    }

    const { businessReference } = query.data

    if (businessReference === orderLifecycleReferences.serverError) {
      return serverError()
    }

    return HttpResponse.json(
      orderLifecycles
        .filter((lifecycle) => lifecycle.businessReference === businessReference)
        .toSorted((a, b) => a.tradingPartner.name.localeCompare(b.tradingPartner.name)),
    )
  })
}
