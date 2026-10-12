import { delay, http, HttpResponse } from 'msw'

import {
  type OverdueAcknowledgement,
  type RunSummary,
  type Task,
  taskCountsOf,
  type Tasks,
  tasksEndpoint,
  tasksSchema,
  type TradingPartner,
  whoActsOnFailedRun,
} from '@edi-bridge/contracts'

import { hour } from './overdue'
import { createOverviewData, seedOverdueAcknowledgements, tradingPartnerHealthOf } from './overview'
import { serverError } from './responses'
import { seedRuns } from './run'
import { seedReprocessed } from './run-detail'
import { createRunStore, type RunStore, toRunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

export type TasksData = {
  runs: ReadonlyArray<RunSummary> | RunStore
  tradingPartners: ReadonlyArray<TradingPartner>
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
}

export const tasksLookback = 24 * hour

function failedRunTasks(runs: RunStore, from: number) {
  return runs.all().flatMap((run): Task[] =>
    run.status === 'failed' &&
    Date.parse(run.receivedAt) >= from &&
    runs.replacingOf(run.id) === undefined
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
    whoActs: 'partner',
    tradingPartner: acknowledgement.tradingPartner,
    at: acknowledgement.overdueSince,
    interchange: acknowledgement.interchange,
    messageType: acknowledgement.messageType,
    sentAt: acknowledgement.sentAt,
    acknowledgementTimeLimitHours: acknowledgement.acknowledgementTimeLimitHours,
    target: { kind: 'interchange', interchangeId: acknowledgement.interchange.id },
  }))
}

function failingTradingPartnerTasks(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: readonly RunSummary[],
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
  from: number,
  now: Date,
) {
  return tradingPartnerHealthOf(tradingPartners, runs, overdueAcknowledgements, from).flatMap(
    (health): Task[] =>
      health.status === 'failing'
        ? [
            {
              id: `partner:${health.tradingPartner.id}`,
              kind: 'failingTradingPartner',
              whoActs: 'you',
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

export function createTasksData(options: Parameters<typeof createOverviewData>[0]): TasksData {
  return createOverviewData(options)
}

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

function tasksDataOf(source: TasksData | 'empty' | 'large' | undefined): TasksData {
  switch (source) {
    case undefined:
      return seedTasksData()
    case 'empty':
      return emptyTasksData
    case 'large':
      return createTasksData({ tradingPartnerCount: 240, overdueCount: 400, runCount: 30_000 })
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
