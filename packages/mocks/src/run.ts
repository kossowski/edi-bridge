import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type FailureStage,
  fromSearchParams,
  type MessageType,
  type RunListQuery,
  runsEndpoint,
  type RunStatus,
  type RunSummary,
  runSummarySchema,
} from '@edi-bridge/contracts'

import { directionOf, seedFlows } from './flow'
import { type RunStore, toRunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

function pickFailureStage(faker: Faker, messageType: MessageType): FailureStage {
  // Outbound Documents come from the ERP as JSON or CSV, so they never fail at EDIFACT parsing.
  // A CONTRL is linked to its Interchange, not mapped, so no Mapping Version could fix it.
  const stages: FailureStage[] =
    directionOf({ messageType }) === 'outbound'
      ? ['mapping', 'validation', 'delivery']
      : messageType === 'CONTRL'
        ? ['parse', 'validation', 'delivery']
        : ['parse', 'validation', 'mapping', 'delivery']

  return faker.helpers.arrayElement(stages)
}

function generateRun(faker: Faker, receivedAt: Date) {
  const flow = faker.helpers.arrayElement(seedFlows)
  const tradingPartner = seedTradingPartners.find(({ id }) => id === flow.tradingPartnerId)!

  const status = faker.helpers.weightedArrayElement<RunStatus>([
    { value: 'delivered', weight: 78 },
    { value: 'failed', weight: 10 },
    { value: 'duplicate', weight: 5 },
    { value: 'processing', weight: 4 },
    { value: 'received', weight: 3 },
  ])

  return {
    id: faker.string.uuid(),
    status,
    failureStage: status === 'failed' ? pickFailureStage(faker, flow.messageType) : null,
    receivedAt: receivedAt.toISOString(),
    tradingPartner,
    messageType: flow.messageType,
    flow: { id: flow.id, name: flow.name },
    manualSubmission: faker.datatype.boolean({ probability: 0.04 }),
  }
}

export function createRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return runSummarySchema.parse({
    ...generateRun(defaultFaker, defaultFaker.date.recent({ days: 30 })),
    ...overrides,
  })
}

export function createRuns({
  count,
  now = new Date(),
  days = 30,
  seed = 7,
}: {
  count: number
  now?: Date
  days?: number
  seed?: number
}): RunSummary[] {
  const faker = new Faker({ locale: [en], seed })
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const runs: RunSummary[] = []

  while (runs.length < count) {
    const run = generateRun(faker, faker.date.between({ from, to: now }))

    // Retailers often bundle several ORDERS into one Interchange, which is split into one Run each.
    const bundled =
      run.messageType === 'ORDERS' && faker.datatype.boolean({ probability: 0.2 })
        ? faker.number.int({ min: 1, max: 3 })
        : 0

    const siblings = Array.from({ length: bundled }, () => ({
      ...generateRun(faker, new Date(run.receivedAt)),
      tradingPartner: run.tradingPartner,
      messageType: run.messageType,
      flow: run.flow,
    }))

    runs.push(...[run, ...siblings].map((item) => runSummarySchema.parse(item)))
  }

  return runs.slice(0, count)
}

let seedRunsCache: RunSummary[] | undefined

export function seedRuns() {
  seedRunsCache ??= createRuns({ count: 12_000 })

  return seedRunsCache
}

function matches(run: RunSummary, query: RunListQuery) {
  const receivedAt = Date.parse(run.receivedAt)

  return (
    (!query.status?.length || query.status.includes(run.status)) &&
    (!query.failureStage?.length ||
      (run.failureStage !== null && query.failureStage.includes(run.failureStage))) &&
    (!query.tradingPartnerId?.length || query.tradingPartnerId.includes(run.tradingPartner.id)) &&
    (!query.messageType?.length || query.messageType.includes(run.messageType)) &&
    (!query.flowId?.length || query.flowId.includes(run.flow.id)) &&
    (query.receivedFrom === undefined || receivedAt >= Date.parse(query.receivedFrom)) &&
    (query.receivedTo === undefined || receivedAt <= Date.parse(query.receivedTo)) &&
    (query.manualSubmission === undefined || run.manualSubmission === query.manualSubmission)
  )
}

export function runsHandler(apiUrl: string, runs?: ReadonlyArray<RunSummary> | RunStore) {
  let store: RunStore | undefined

  return http.get(`${apiUrl}${runsEndpoint.path}`, ({ request }) => {
    const query = runsEndpoint.query.safeParse(fromSearchParams(new URL(request.url).searchParams))

    if (!query.success) {
      return HttpResponse.json({ message: query.error.message }, { status: 400 })
    }

    store ??= toRunStore(runs ?? seedRuns())
    const { page, pageSize } = query.data
    const filtered = store.newestFirst().filter((run) => matches(run, query.data))

    return HttpResponse.json({
      runs: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
    })
  })
}
