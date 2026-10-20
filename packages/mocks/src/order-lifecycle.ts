import { delay, http, HttpResponse } from 'msw'

import {
  type AcknowledgementNotSentReason,
  type AcknowledgementState,
  businessReferenceSchema,
  directionOf,
  type FailureStage,
  fromSearchParams,
  type OrderLifecycle,
  orderLifecycleEndpoint,
  type OrderLifecycleInterchange,
  type OrderLifecycleMessage,
  orderLifecycleMessageSchema,
  type OrderLifecycleMessageType,
  orderLifecycleMessageTypeSchema,
  orderLifecycleSchema,
  orderLifecyclesEndpoint,
  type OrderLifecycleStatus,
  type OrderLifecycleSummary,
  oldestFirst,
  type RunSummary,
  toOrderLifecycleSummary,
  type TradingPartner,
  type TradingPartnerSummary,
} from '@edi-bridge/contracts'

import { seedFlows } from './flow'
import { includesText, pageOf } from './list'
import { hour, isUnacknowledged, overdueSinceOf } from './overdue'
import { badRequest, serverError } from './responses'
import { toRunSummary } from './run'
import { controlReferenceOf, createRunStore, type Reprocessed, type RunStore } from './run-store'
import { stableUuid } from './seed-id'
import { seedTradingPartners, type TradingPartnerStore } from './trading-partner'

export const orderLifecycleReferences = {
  full: '4711',
  partial: '4712',
  multiPartner: '4713',
  failures: '4714',
  largeVolume: '4715',
  onTrack: '4716',
  waitingForTradingPartner: '4717',
  noMatch: '0000',
  serverError: '5000',
} as const

// Untracked: handed over before Acknowledgements were tracked, so it has none.
type AcknowledgementOutcome = Extract<AcknowledgementState, 'accepted' | 'rejected'> | 'untracked'

type MessageSeed = {
  messageType: OrderLifecycleMessageType
  hoursAgo: number
  outcome: 'delivered' | FailureStage
  acknowledgement?: AcknowledgementOutcome | undefined
  notSentReason?: AcknowledgementNotSentReason | undefined
  waitingHoursAgo?: number
  reprocessed?: { hoursAgo: number; acknowledgement?: AcknowledgementOutcome | undefined }
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
      {
        messageType: 'ORDERS',
        hoursAgo: 30,
        outcome: 'delivered',
        notSentReason: 'unechoableInterchangeHeader',
      },
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
        acknowledgement: 'untracked',
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
  {
    businessReference: orderLifecycleReferences.onTrack,
    tradingPartner: 'Spreewald Frische GmbH',
    messages: [{ messageType: 'ORDERS', hoursAgo: 2, outcome: 'delivered' }],
  },
  {
    businessReference: orderLifecycleReferences.waitingForTradingPartner,
    tradingPartner: 'Rheinkauf eG',
    messages: [{ messageType: 'ORDERS', hoursAgo: 20, outcome: 'parse', waitingHoursAgo: 18 }],
  },
]

export type OrderLifecycleSeed = {
  runs: RunSummary[]
  reprocessed: Reprocessed[]
  orderLifecycles: OrderLifecycle[]
  waitingForTradingPartnerSince: Map<string, string>
}

function lifecycleTradingPartnerOf({
  id,
  name,
  acknowledgementTimeLimitHours,
}: TradingPartnerSummary & Pick<TradingPartner, 'acknowledgementTimeLimitHours'>) {
  return { id, name, acknowledgementTimeLimitHours }
}

function acknowledgementOf(
  sentAt: string,
  outcome: AcknowledgementOutcome | undefined,
  tradingPartner: Pick<TradingPartner, 'acknowledgementTimeLimitHours'>,
  now: Date,
): AcknowledgementState | null {
  if (outcome === 'untracked') {
    return null
  }

  return (
    outcome ?? (overdueSinceOf(sentAt, tradingPartner) <= now.getTime() ? 'overdue' : 'pending')
  )
}

function interchangeOf(
  run: RunSummary,
  acknowledgement: AcknowledgementOutcome | undefined,
  tradingPartner: Pick<TradingPartner, 'acknowledgementTimeLimitHours'>,
  now: Date,
  notSentReason?: AcknowledgementNotSentReason,
): OrderLifecycleInterchange | null {
  if (run.interchange === null) {
    return null
  }

  const sent = directionOf(run) === 'outbound' && run.status === 'delivered'

  return {
    ...run.interchange,
    acknowledgement: sent
      ? acknowledgementOf(run.receivedAt, acknowledgement, tradingPartner, now)
      : null,
    notSentReason: notSentReason ?? null,
  }
}

type MessageEntry = {
  runId: string
  acknowledgement: AcknowledgementOutcome | undefined
  notSentReason?: AcknowledgementNotSentReason | undefined
  replacedBy: RunSummary | null
}

export function seedOrderLifecycles(now = new Date(), seeds = lifecycleSeeds): OrderLifecycleSeed {
  const runs: RunSummary[] = []
  const reprocessed: Reprocessed[] = []
  const waitingForTradingPartnerSince = new Map<string, string>()

  const seeded = seeds.map(({ businessReference, messages, ...seed }) => {
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

      if (message.waitingHoursAgo !== undefined) {
        waitingForTradingPartnerSince.set(
          run.id,
          new Date(now.getTime() - message.waitingHoursAgo * hour).toISOString(),
        )
      }

      if (!message.reprocessed) {
        return [
          {
            runId: run.id,
            acknowledgement: message.acknowledgement,
            notSentReason: message.notSentReason,
            replacedBy: null,
          },
        ]
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
          notSentReason: message.notSentReason,
          replacedBy: null,
        },
      ]
    })

    return { businessReference, tradingPartner, entries }
  })

  const store = createRunStore(runs, reprocessed)

  const orderLifecycles = seeded.map(({ businessReference, tradingPartner, entries }) => {
    const toMessage = ({ runId, acknowledgement, notSentReason, replacedBy }: MessageEntry) => {
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
          waitingForTradingPartnerSince: waitingForTradingPartnerSince.get(run.id) ?? null,
        },
        interchange: interchangeOf(run, acknowledgement, tradingPartner, now, notSentReason),
      })
    }

    return orderLifecycleSchema.parse({
      businessReference,
      tradingPartner: lifecycleTradingPartnerOf(tradingPartner),
      messages: oldestFirst(entries.map(toMessage)),
    })
  })

  return { runs, reprocessed, orderLifecycles, waitingForTradingPartnerSince }
}

type VolumeStep = {
  messageType: OrderLifecycleMessageType
  hoursAgo: number
  outcome: 'delivered' | 'processing' | FailureStage
  acknowledgement?: AcknowledgementOutcome
  waiting?: boolean
}

const volumeProfiles: ReadonlyArray<(hoursAgo: number, limit: number) => VolumeStep[]> = [
  (hoursAgo) => [{ messageType: 'ORDERS', hoursAgo, outcome: 'delivered' }],
  (hoursAgo) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + 6, outcome: 'delivered' },
    { messageType: 'DESADV', hoursAgo, outcome: 'processing' },
  ],
  (hoursAgo) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + 48, outcome: 'delivered' },
    {
      messageType: 'DESADV',
      hoursAgo: hoursAgo + 24,
      outcome: 'delivered',
      acknowledgement: 'accepted',
    },
    { messageType: 'INVOIC', hoursAgo, outcome: 'delivered', acknowledgement: 'accepted' },
  ],
  (hoursAgo, limit) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + 6, outcome: 'delivered' },
    { messageType: 'DESADV', hoursAgo: Math.min(hoursAgo, limit / 2), outcome: 'delivered' },
  ],
  (hoursAgo) => [{ messageType: 'ORDERS', hoursAgo, outcome: 'parse', waiting: true }],
  (hoursAgo) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + 6, outcome: 'delivered' },
    { messageType: 'DESADV', hoursAgo, outcome: 'mapping' },
  ],
  (hoursAgo, limit) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + limit + 30, outcome: 'delivered' },
    {
      messageType: 'DESADV',
      hoursAgo: hoursAgo + limit + 6,
      outcome: 'delivered',
      acknowledgement: 'accepted',
    },
    { messageType: 'INVOIC', hoursAgo: hoursAgo + limit + 1, outcome: 'delivered' },
  ],
  (hoursAgo) => [
    { messageType: 'ORDERS', hoursAgo: hoursAgo + 30, outcome: 'delivered' },
    { messageType: 'DESADV', hoursAgo, outcome: 'delivered', acknowledgement: 'rejected' },
  ],
]

export function createLargeVolumeOrderLifecycles({
  count = 320,
  now = new Date(),
}: { count?: number; now?: Date } = {}): OrderLifecycle[] {
  return Array.from({ length: count }, (_, index) => {
    const tradingPartner = seedTradingPartners[index % seedTradingPartners.length]!
    const profile = volumeProfiles[Math.floor(index / 2) % volumeProfiles.length]!
    const businessReference = `PO8${String(index + 1).padStart(5, '0')}`

    const messages = profile(index * 1.5 + 0.25, tradingPartner.acknowledgementTimeLimitHours).map(
      (step, position): OrderLifecycleMessage => {
        const id = stableUuid(`order-lifecycle:large:${businessReference}:${position}`)
        const receivedAt = new Date(now.getTime() - step.hoursAgo * hour).toISOString()
        const direction = directionOf(step)

        const run =
          step.outcome === 'delivered' || step.outcome === 'processing'
            ? {
                id,
                status: step.outcome,
                failureStage: null,
                replacedBy: null,
                waitingForTradingPartnerSince: null,
              }
            : {
                id,
                status: 'failed' as const,
                failureStage: step.outcome,
                replacedBy: null,
                waitingForTradingPartnerSince: step.waiting
                  ? new Date(Date.parse(receivedAt) + hour).toISOString()
                  : null,
              }

        return {
          messageType: step.messageType,
          direction,
          receivedAt,
          run,
          interchange:
            step.outcome === 'delivered'
              ? {
                  id,
                  controlReference: controlReferenceOf(id),
                  acknowledgement:
                    direction === 'outbound'
                      ? acknowledgementOf(receivedAt, step.acknowledgement, tradingPartner, now)
                      : null,
                  notSentReason: null,
                }
              : null,
        }
      },
    )

    return orderLifecycleSchema.parse({
      businessReference,
      tradingPartner: lifecycleTradingPartnerOf(tradingPartner),
      messages: oldestFirst(messages),
    })
  })
}

const defaultTimeLimit = { acknowledgementTimeLimitHours: 24 }

type OrderLifecycleSourceOptions = {
  runs?: RunStore | undefined
  tradingPartners?: Pick<TradingPartnerStore, 'get'>
  waitingForTradingPartnerSince?: ReadonlyMap<string, string>
}

const seedTradingPartnerLookup: Pick<TradingPartnerStore, 'get'> = {
  get: (id) => seedTradingPartners.find((candidate) => candidate.id === id),
}

// Without a curated seed, the Runs of a Business Reference form one Order Lifecycle per Trading
// Partner, with the same Acknowledgements that GET /tasks lists as overdue.
function createOrderLifecycleSource(
  curated: ReadonlyArray<OrderLifecycle>,
  {
    runs,
    tradingPartners = seedTradingPartnerLookup,
    waitingForTradingPartnerSince,
  }: OrderLifecycleSourceOptions,
) {
  const curatedReferences = new Set(curated.map(({ businessReference }) => businessReference))
  let derivedFor: readonly RunSummary[] | undefined
  let derived: OrderLifecycle[] = []

  function lifecyclesOfRuns(
    store: RunStore,
    lifecycleRuns: readonly RunSummary[],
    now: Date,
  ): OrderLifecycle[] {
    const byLifecycle = Map.groupBy(
      lifecycleRuns.filter(
        (run) =>
          run.businessReference !== null &&
          !curatedReferences.has(run.businessReference) &&
          orderLifecycleMessageTypeSchema.safeParse(run.messageType).success,
      ),
      (run) => `${run.businessReference} ${run.tradingPartner.id}`,
    )

    return [...byLifecycle.values()].map((group) => {
      const { tradingPartner, businessReference } = group[0]!
      const timeLimit = tradingPartners.get(tradingPartner.id) ?? defaultTimeLimit

      return {
        businessReference: businessReference!,
        tradingPartner: lifecycleTradingPartnerOf({
          ...tradingPartner,
          acknowledgementTimeLimitHours: timeLimit.acknowledgementTimeLimitHours,
        }),
        messages: oldestFirst(group).map((run): OrderLifecycleMessage => ({
          messageType: orderLifecycleMessageTypeSchema.parse(run.messageType),
          direction: directionOf(run),
          receivedAt: run.receivedAt,
          run: {
            ...(run.status === 'failed'
              ? { status: run.status, failureStage: run.failureStage }
              : { status: run.status, failureStage: null }),
            id: run.id,
            replacedBy: replacedByOf(store, run.id),
            waitingForTradingPartnerSince: null,
          },
          interchange: interchangeOf(
            run,
            isUnacknowledged(run) ? undefined : 'accepted',
            timeLimit,
            now,
          ),
        })),
      }
    })
  }

  function replacedByOf(store: RunStore, runId: string) {
    const replacing = store.replacingOf(runId)

    return replacing !== undefined && store.get(replacing) ? { id: replacing } : null
  }

  function withWaiting(lifecycle: OrderLifecycle): OrderLifecycle {
    if (!waitingForTradingPartnerSince?.size) {
      return lifecycle
    }

    return {
      ...lifecycle,
      messages: lifecycle.messages.map((message) => {
        const since = waitingForTradingPartnerSince.get(message.run.id)

        return message.run.status === 'failed' && since !== undefined
          ? { ...message, run: { ...message.run, waitingForTradingPartnerSince: since } }
          : message
      }),
    }
  }

  function all() {
    // The Run store returns a new array after every change, so a new array means new Runs.
    if (runs && derivedFor !== runs.all()) {
      derivedFor = runs.all()
      derived = lifecyclesOfRuns(runs, derivedFor, new Date())
    }

    return [...curated, ...derived].map(withWaiting)
  }

  function of(businessReference: string) {
    const found = curatedReferences.has(businessReference)
      ? curated.filter((lifecycle) => lifecycle.businessReference === businessReference)
      : runs
        ? lifecyclesOfRuns(runs, runs.withBusinessReference(businessReference), new Date())
        : []

    return found.map((lifecycle) => orderLifecycleSchema.parse(withWaiting(lifecycle)))
  }

  return { all, of }
}

export type OrderLifecycleState = 'loading' | 'error'

function unavailableHandler(path: string, state: OrderLifecycleState) {
  return state === 'loading'
    ? http.get(path, async () => {
        await delay('infinite')
      })
    : http.get(path, () => serverError())
}

export function orderLifecycleHandler(
  apiUrl: string,
  source?: ReadonlyArray<OrderLifecycle> | OrderLifecycleState,
  options: OrderLifecycleSourceOptions = {},
) {
  const path = `${apiUrl}${orderLifecycleEndpoint.path}`

  if (source === 'loading' || source === 'error') {
    return unavailableHandler(path, source)
  }

  let lifecycles: ReturnType<typeof createOrderLifecycleSource> | undefined

  return http.get(path, ({ params }) => {
    lifecycles ??= createOrderLifecycleSource(
      source ?? seedOrderLifecycles().orderLifecycles,
      options,
    )

    const businessReference = businessReferenceSchema.safeParse(params.businessReference)

    if (!businessReference.success) {
      return badRequest(businessReference.error.message)
    }

    if (businessReference.data === orderLifecycleReferences.serverError) {
      return serverError()
    }

    return HttpResponse.json(
      lifecycles
        .of(businessReference.data)
        .toSorted((a, b) => a.tradingPartner.name.localeCompare(b.tradingPartner.name)),
    )
  })
}

export type OrderLifecycleListState = 'empty' | 'large' | 'loading' | 'error'

// Shared by every handler because building and parsing the large volume is slow.
let largeVolumeOrderLifecycles: OrderLifecycle[] | undefined

function listSourceOf(source: ReadonlyArray<OrderLifecycle> | 'empty' | 'large' | undefined) {
  switch (source) {
    case undefined: {
      return seedOrderLifecycles().orderLifecycles
    }

    case 'empty': {
      return []
    }

    case 'large': {
      return (largeVolumeOrderLifecycles ??= createLargeVolumeOrderLifecycles())
    }

    default: {
      return source
    }
  }
}

function statusCountsOf(summaries: ReadonlyArray<OrderLifecycleSummary>) {
  const statusCounts: Record<OrderLifecycleStatus, number> = {
    'on-track': 0,
    'needs-attention': 0,
    'waiting-for-trading-partner': 0,
    done: 0,
  }

  for (const { status } of summaries) {
    statusCounts[status] += 1
  }

  return statusCounts
}

export function orderLifecycleListHandler(
  apiUrl: string,
  source?: ReadonlyArray<OrderLifecycle> | OrderLifecycleListState,
  options: OrderLifecycleSourceOptions = {},
) {
  const path = `${apiUrl}${orderLifecyclesEndpoint.path}`

  if (source === 'loading' || source === 'error') {
    return unavailableHandler(path, source)
  }

  let lifecycles: ReturnType<typeof createOrderLifecycleSource> | undefined

  return http.get(path, ({ request }) => {
    lifecycles ??= createOrderLifecycleSource(listSourceOf(source), options)

    const query = orderLifecyclesEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    if (!query.success) {
      return badRequest(query.error.message)
    }

    const text = query.data.q?.toLowerCase() ?? ''
    const statuses = query.data.status ?? []

    const searched = lifecycles
      .all()
      .flatMap((lifecycle) =>
        text === '' ||
        includesText(lifecycle.businessReference, text) ||
        includesText(lifecycle.tradingPartner.name, text)
          ? [toOrderLifecycleSummary(lifecycle)]
          : [],
      )

    const filtered = searched
      .filter(({ status }) => statuses.length === 0 || statuses.includes(status))
      .toSorted(
        (a, b) =>
          Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) ||
          a.businessReference.localeCompare(b.businessReference),
      )

    const { items, ...paging } = pageOf(filtered, query.data)

    return HttpResponse.json({
      orderLifecycles: items,
      statusCounts: statusCountsOf(searched),
      ...paging,
    })
  })
}
