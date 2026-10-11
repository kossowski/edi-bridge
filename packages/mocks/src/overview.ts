import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { delay, http, HttpResponse } from 'msw'

import {
  directionOf,
  failureStages,
  type FinishedRunCounts,
  fromSearchParams,
  type HealthStatus,
  healthStatuses,
  healthStatusOf,
  messageTypes,
  type OverdueAcknowledgement,
  overdueAcknowledgementMessageTypes,
  overdueAcknowledgementSchema,
  type Overview,
  overviewEndpoint,
  type OverviewQuery,
  overviewSchema,
  overviewWindowSizes,
  type RunStatus,
  type RunSummary,
  runSummarySchema,
  type TradingPartner,
  type TradingPartnerHealth,
} from '@edi-bridge/contracts'

import { hash } from './hash'
import { hour, overdueSinceOf } from './overdue'
import { badRequest, serverError } from './responses'
import { seedRuns } from './run'
import { controlReferenceOf, interchangeIdOf } from './run-detail'
import { type RunStore, toRunStore } from './run-store'
import { createTradingPartners, seedTradingPartners } from './trading-partner'

export type OverviewData = {
  runs: ReadonlyArray<RunSummary> | RunStore
  tradingPartners: ReadonlyArray<TradingPartner>
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
}

const minute = 60 * 1000

const overdueLookback = 72 * hour

function generateOverdueAcknowledgement(
  faker: Faker,
  tradingPartner: Pick<TradingPartner, 'id' | 'name' | 'acknowledgementTimeLimitHours'>,
  now: Date,
): OverdueAcknowledgement {
  const overdueSince = faker.date.between({ from: now.getTime() - overdueLookback, to: now })
  const { acknowledgementTimeLimitHours } = tradingPartner
  const id = faker.string.uuid()

  return {
    interchange: { id, controlReference: controlReferenceOf(id) },
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    messageType: faker.helpers.arrayElement(overdueAcknowledgementMessageTypes),
    sentAt: new Date(overdueSince.getTime() - acknowledgementTimeLimitHours * hour).toISOString(),
    acknowledgementTimeLimitHours,
    overdueSince: overdueSince.toISOString(),
  }
}

export function createOverdueAcknowledgement(
  overrides: Partial<OverdueAcknowledgement> = {},
): OverdueAcknowledgement {
  const tradingPartner = defaultFaker.helpers.arrayElement(
    seedTradingPartners.filter(({ testMode }) => !testMode),
  )

  return overdueAcknowledgementSchema.parse({
    ...generateOverdueAcknowledgement(defaultFaker, tradingPartner, new Date()),
    ...overrides,
  })
}

const worstFirst = (status: HealthStatus) => -healthStatuses.indexOf(status)

const isFinished = (status: RunStatus): status is keyof FinishedRunCounts =>
  status === 'delivered' || status === 'failed'

function tradingPartnerHealthOf(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: readonly RunSummary[],
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
  from: number,
) {
  const counts = new Map<string, Omit<TradingPartnerHealth, 'tradingPartner' | 'status'>>(
    tradingPartners.map(({ id }) => [id, { delivered: 0, failed: 0, overdue: 0, lastRunAt: null }]),
  )

  for (const run of runs) {
    const count = counts.get(run.tradingPartner.id)

    if (!count) {
      continue
    }

    if (count.lastRunAt === null || Date.parse(run.receivedAt) > Date.parse(count.lastRunAt)) {
      count.lastRunAt = run.receivedAt
    }

    if (Date.parse(run.receivedAt) >= from && isFinished(run.status)) {
      count[run.status] += 1
    }
  }

  for (const { tradingPartner } of overdueAcknowledgements) {
    const count = counts.get(tradingPartner.id)

    if (count) {
      count.overdue += 1
    }
  }

  return tradingPartners
    .map(({ id, name }) => {
      const count = counts.get(id)!

      return { tradingPartner: { id, name }, status: healthStatusOf(count), ...count }
    })
    .sort(
      (a, b) =>
        worstFirst(a.status) - worstFirst(b.status) ||
        a.tradingPartner.name.localeCompare(b.tradingPartner.name),
    )
}

export function toOverview(
  { runs, tradingPartners, overdueAcknowledgements }: OverviewData,
  { window }: OverviewQuery,
  now = new Date(),
): Overview {
  const { durationMinutes, bucketMinutes } = overviewWindowSizes[window]
  const bucketMs = bucketMinutes * minute
  const to = Math.floor(now.getTime() / bucketMs) * bucketMs + bucketMs
  const from = to - durationMinutes * minute

  const throughput = Array.from({ length: durationMinutes / bucketMinutes }, (_, index) => ({
    start: new Date(from + index * bucketMs).toISOString(),
    end: new Date(from + (index + 1) * bucketMs).toISOString(),
    delivered: 0,
    failed: 0,
  }))

  const all = toRunStore(runs).all()

  for (const run of all) {
    const receivedAt = Date.parse(run.receivedAt)
    const bucket = throughput[Math.floor((receivedAt - from) / bucketMs)]

    if (bucket && isFinished(run.status)) {
      bucket[run.status] += 1
    }
  }

  return overviewSchema.parse({
    window,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    throughput,
    tradingPartners: tradingPartnerHealthOf(tradingPartners, all, overdueAcknowledgements, from),
    overdueAcknowledgements: [...overdueAcknowledgements].sort(
      (a, b) => Date.parse(a.overdueSince) - Date.parse(b.overdueSince),
    ),
  })
}

export const emptyOverviewData: OverviewData = {
  runs: [],
  tradingPartners: [],
  overdueAcknowledgements: [],
}

const healthProfiles = [
  { value: { errorShare: 0.01, overdue: false }, weight: 60 },
  { value: { errorShare: 0.1, overdue: true }, weight: 25 },
  { value: { errorShare: 0.4, overdue: true }, weight: 15 },
]

export function createOverviewData({
  tradingPartnerCount,
  overdueCount,
  runCount,
  now = new Date(),
  seed = 16,
}: {
  tradingPartnerCount: number
  overdueCount: number
  runCount: number
  now?: Date
  seed?: number
}): OverviewData {
  const faker = new Faker({ locale: [en], seed })
  const tradingPartners = createTradingPartners({ count: tradingPartnerCount, now, seed })

  const profiled = tradingPartners.map((tradingPartner) => ({
    tradingPartner,
    ...faker.helpers.weightedArrayElement(healthProfiles),
  }))

  const from = new Date(now.getTime() - overviewWindowSizes['7d'].durationMinutes * minute)

  const runs = Array.from({ length: runCount }, () => {
    const { tradingPartner, errorShare } = faker.helpers.arrayElement(profiled)
    const messageType = faker.helpers.arrayElement(messageTypes)

    const base = {
      id: faker.string.uuid(),
      receivedAt: faker.date.between({ from, to: now }).toISOString(),
      tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
      messageType,
      flow: { id: faker.string.uuid(), name: `${tradingPartner.name} ${messageType}` },
      manualSubmission: false,
    }

    return runSummarySchema.parse(
      faker.datatype.boolean({ probability: errorShare })
        ? { ...base, status: 'failed', failureStage: faker.helpers.arrayElement(failureStages) }
        : { ...base, status: 'delivered', failureStage: null },
    )
  })

  const inProduction = profiled.filter(({ tradingPartner }) => !tradingPartner.testMode)
  const overdueProfiled = inProduction.filter(({ overdue }) => overdue)
  const overdueCandidates = overdueProfiled.length > 0 ? overdueProfiled : inProduction

  const overdueAcknowledgements =
    overdueCandidates.length === 0
      ? []
      : Array.from({ length: overdueCount }, () =>
          overdueAcknowledgementSchema.parse(
            generateOverdueAcknowledgement(
              faker,
              faker.helpers.arrayElement(overdueCandidates).tradingPartner,
              now,
            ),
          ),
        )

  return { runs, tradingPartners, overdueAcknowledgements }
}

function isUnacknowledged(run: RunSummary) {
  return hash(`overdue:${run.id}`) / 2 ** 32 < 0.02
}

// An outbound Run delivers its own Interchange, so a few recent delivered ones stand for sent
// Interchanges whose Acknowledgement never arrived. Test Mode traffic is checked during onboarding.
export function seedOverdueAcknowledgements(
  runs: ReadonlyArray<RunSummary> = seedRuns(),
  tradingPartners: ReadonlyArray<TradingPartner> = seedTradingPartners,
  now = new Date(),
): OverdueAcknowledgement[] {
  const byId = new Map(tradingPartners.map((tradingPartner) => [tradingPartner.id, tradingPartner]))

  return runs.flatMap((run) => {
    const tradingPartner = byId.get(run.tradingPartner.id)

    if (
      !tradingPartner ||
      tradingPartner.testMode ||
      run.status !== 'delivered' ||
      Date.parse(run.receivedAt) < now.getTime() - overdueLookback ||
      directionOf(run) !== 'outbound' ||
      !isUnacknowledged(run)
    ) {
      return []
    }

    const { acknowledgementTimeLimitHours } = tradingPartner
    const overdueSince = overdueSinceOf(run.receivedAt, tradingPartner)

    if (overdueSince > now.getTime()) {
      return []
    }

    const id = interchangeIdOf(run)

    return [
      overdueAcknowledgementSchema.parse({
        interchange: { id, controlReference: controlReferenceOf(id) },
        tradingPartner: run.tradingPartner,
        messageType: run.messageType,
        sentAt: run.receivedAt,
        acknowledgementTimeLimitHours,
        overdueSince: new Date(overdueSince).toISOString(),
      }),
    ]
  })
}

export function seedOverviewData(
  runs: ReadonlyArray<RunSummary> | RunStore = seedRuns(),
): OverviewData {
  const store = toRunStore(runs)

  return {
    runs: store,
    tradingPartners: seedTradingPartners,
    get overdueAcknowledgements() {
      return seedOverdueAcknowledgements(store.all())
    },
  }
}

export type OverviewState = 'empty' | 'large' | 'loading' | 'error'

function overviewDataOf(source: OverviewData | 'empty' | 'large' | undefined): OverviewData {
  switch (source) {
    case undefined:
      return seedOverviewData()
    case 'empty':
      return emptyOverviewData
    case 'large':
      return createOverviewData({ tradingPartnerCount: 240, overdueCount: 400, runCount: 30_000 })
    default:
      return source
  }
}

export function overviewHandler(apiUrl: string, source?: OverviewData | OverviewState) {
  const path = `${apiUrl}${overviewEndpoint.path}`

  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  let data: OverviewData | undefined

  return http.get(path, ({ request }) => {
    data ??= overviewDataOf(source)

    const query = overviewEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    if (!query.success) {
      return badRequest(query.error.message)
    }

    return HttpResponse.json(toOverview(data, query.data))
  })
}
