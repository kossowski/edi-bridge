import { en, Faker } from '@faker-js/faker'
import { delay, http, HttpResponse } from 'msw'

import {
  failureStages,
  type FinishedRunCounts,
  type HealthStatus,
  healthStatuses,
  healthStatusOf,
  messageTypes,
  type OverdueAcknowledgement,
  overdueAcknowledgementSchema,
  type RunStatus,
  type RunSummary,
  type Task,
  type TaskActor,
  taskActors,
  taskCountsOf,
  type Tasks,
  tasksEndpoint,
  tasksSchema,
  type TradingPartner,
  whoActsOnFailedRun,
} from '@edi-bridge/contracts'

import { hour } from './overdue'
import {
  generateOverdueAcknowledgement,
  seedOverdueAcknowledgements,
} from './overdue-acknowledgement'
import { serverError } from './responses'
import { seedRuns, toRunSummary } from './run'
import { seedReprocessed } from './run-detail'
import { createRunStore, type RunStore, toRunStore } from './run-store'
import { createTradingPartners, seedTradingPartners } from './trading-partner'

export type TasksData = {
  runs: ReadonlyArray<RunSummary> | RunStore
  tradingPartners: ReadonlyArray<TradingPartner>
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
}

const tasksLookback = 24 * hour

type TradingPartnerHealth = FinishedRunCounts & {
  tradingPartner: Pick<TradingPartner, 'id' | 'name'>
  status: HealthStatus
  overdue: number
  lastRunAt: string | null
}

const worstFirst = (status: HealthStatus) => -healthStatuses.indexOf(status)

const isFinished = (status: RunStatus): status is keyof FinishedRunCounts =>
  status === 'delivered' || status === 'failed'

function tradingPartnerHealthOf(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: readonly RunSummary[],
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
  from: number,
): TradingPartnerHealth[] {
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

type FailedRun = Extract<RunSummary, { status: 'failed' }>

const isFailed = (run: RunSummary): run is FailedRun => run.status === 'failed'

function failedRunTasks(runs: RunStore, from: number) {
  return runs.all().flatMap((run): Task[] =>
    isFailed(run) && Date.parse(run.receivedAt) >= from && runs.replacingOf(run.id) === undefined
      ? [
          {
            id: `run:${run.id}`,
            kind: 'failedRun',
            whoActs: whoActsOnFailedRun(run),
            tradingPartner: run.tradingPartner,
            at: run.receivedAt,
            run: { id: run.id, messageType: run.messageType, failureStage: run.failureStage },
            target: { kind: 'run', runId: run.id },
          },
        ]
      : [],
  )
}

function overdueAcknowledgementTasks(
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
): Task[] {
  return overdueAcknowledgements.map((acknowledgement) => ({
    id: `overdue:${acknowledgement.interchange.id}`,
    kind: 'overdueAcknowledgement',
    whoActs: 'tradingPartner',
    tradingPartner: acknowledgement.tradingPartner,
    at: acknowledgement.overdueSince,
    interchange: acknowledgement.interchange,
    messageType: acknowledgement.messageType,
    sentAt: acknowledgement.sentAt,
    acknowledgementTimeLimitHours: acknowledgement.acknowledgementTimeLimitHours,
    target: {
      kind: 'interchange',
      controlReference: acknowledgement.interchange.controlReference,
    },
  }))
}

function dominantWhoActs(failedRuns: readonly FailedRun[]): TaskActor {
  const counts = taskCountsOf(failedRuns.map((run) => ({ whoActs: whoActsOnFailedRun(run) })))
  const [first, second] = taskActors.toSorted((a, b) => counts[b] - counts[a])

  return counts[first!] > counts[second!] ? first! : 'you'
}

function failingTradingPartnerTasks(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: readonly RunSummary[],
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
  from: number,
  now: Date,
) {
  const failedRuns = Map.groupBy(
    runs.filter(isFailed).filter((run) => Date.parse(run.receivedAt) >= from),
    (run) => run.tradingPartner.id,
  )

  return tradingPartnerHealthOf(tradingPartners, runs, overdueAcknowledgements, from).flatMap(
    (health): Task[] =>
      health.status === 'failing'
        ? [
            {
              id: `tradingPartner:${health.tradingPartner.id}`,
              kind: 'failingTradingPartner',
              whoActs: dominantWhoActs(failedRuns.get(health.tradingPartner.id) ?? []),
              tradingPartner: health.tradingPartner,
              at: health.lastRunAt ?? now.toISOString(),
              delivered: health.delivered,
              failed: health.failed,
              target: { kind: 'tradingPartner', tradingPartnerId: health.tradingPartner.id },
            },
          ]
        : [],
  )
}

export function toTasks(
  { runs, tradingPartners, overdueAcknowledgements }: TasksData,
  now = new Date(),
): Tasks {
  const from = now.getTime() - tasksLookback
  const store = toRunStore(runs)
  const all = store.all()

  const tasks = [
    ...failedRunTasks(store, from),
    ...overdueAcknowledgementTasks(overdueAcknowledgements),
    ...failingTradingPartnerTasks(tradingPartners, all, overdueAcknowledgements, from, now),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))

  return tasksSchema.parse({ tasks, counts: taskCountsOf(tasks) })
}

export const emptyTasksData: TasksData = {
  runs: [],
  tradingPartners: [],
  overdueAcknowledgements: [],
}

const healthProfiles = [
  { value: { errorShare: 0.01, overdue: false }, weight: 60 },
  { value: { errorShare: 0.1, overdue: true }, weight: 25 },
  { value: { errorShare: 0.4, overdue: true }, weight: 15 },
]

const inProgressLookback = 2 * hour

function generatedRunStatus(faker: Faker, errorShare: number, receivedAt: Date, now: Date) {
  if (
    now.getTime() - receivedAt.getTime() < inProgressLookback &&
    faker.datatype.boolean({ probability: 0.2 })
  ) {
    return { status: 'processing', failureStage: null } as const
  }

  return faker.datatype.boolean({ probability: errorShare })
    ? ({ status: 'failed', failureStage: faker.helpers.arrayElement(failureStages) } as const)
    : ({ status: 'delivered', failureStage: null } as const)
}

export function createTasksData({
  tradingPartnerCount,
  overdueCount,
  runCount,
  days = 30,
  now = new Date(),
  seed = 16,
}: {
  tradingPartnerCount: number
  overdueCount: number
  runCount: number
  days?: number
  now?: Date
  seed?: number
}): TasksData {
  const faker = new Faker({ locale: [en], seed })
  const tradingPartners = createTradingPartners({ count: tradingPartnerCount, now, seed })

  const profiled = tradingPartners.map((tradingPartner) => ({
    tradingPartner,
    ...faker.helpers.weightedArrayElement(healthProfiles),
  }))

  const from = new Date(now.getTime() - days * 24 * hour)

  const runs = Array.from({ length: runCount }, () => {
    const { tradingPartner, errorShare } = faker.helpers.arrayElement(profiled)
    const messageType = faker.helpers.arrayElement(messageTypes)
    const receivedAt = faker.date.between({ from, to: now })

    return toRunSummary({
      id: faker.string.uuid(),
      receivedAt: receivedAt.toISOString(),
      tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
      messageType,
      flow: { id: faker.string.uuid(), name: `${tradingPartner.name} ${messageType}` },
      manualSubmission: false,
      ...generatedRunStatus(faker, errorShare, receivedAt, now),
    })
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

export const largeTasksData = () =>
  createTasksData({ tradingPartnerCount: 240, overdueCount: 500, runCount: 30_000 })

function seedRunStore() {
  const runs = seedRuns()

  return createRunStore(runs, seedReprocessed(runs))
}

export function seedTasksData(runs: RunStore = seedRunStore()): TasksData {
  return {
    runs,
    tradingPartners: seedTradingPartners,
    get overdueAcknowledgements() {
      return seedOverdueAcknowledgements(runs.all())
    },
  }
}

export type TasksState = 'empty' | 'large' | 'loading' | 'error'

export function tasksDataOf(source: TasksData | 'empty' | 'large' | undefined): TasksData {
  switch (source) {
    case undefined:
      return seedTasksData()
    case 'empty':
      return emptyTasksData
    case 'large':
      return largeTasksData()
    default:
      return source
  }
}

export function tasksHandler(apiUrl: string, source?: TasksData | TasksState) {
  const path = `${apiUrl}${tasksEndpoint.path}`

  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  let data: TasksData | undefined

  return http.get(path, () => {
    data ??= tasksDataOf(source)

    return HttpResponse.json(toTasks(data))
  })
}
