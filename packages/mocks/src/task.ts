import { HttpResponse } from 'msw'

import {
  type FinishedRunCounts,
  type HealthStatus,
  healthStatuses,
  healthStatusOf,
  type OverdueAcknowledgement,
  type RunSummary,
  type Task,
  taskCountsOf,
  type Tasks,
  tasksEndpoint,
  tasksSchema,
  type TradingPartner,
  whoActsOnFailedRun,
  whoActsOnFailingTradingPartner,
} from '@edi-bridge/contracts'

import { hour } from './overdue'
import { type RunStore, toRunStore, type WaitingForTradingPartnerSince } from './run-store'
import {
  isFinished,
  type WorkspaceActivity,
  type WorkspaceActivityState,
  workspaceActivityHandler,
} from './workspace-activity'

const tasksLookback = 24 * hour

type TradingPartnerHealth = FinishedRunCounts & {
  tradingPartner: Pick<TradingPartner, 'id' | 'name'>
  status: HealthStatus
  overdue: number
  lastRunAt: string | null
}

const worstFirst = (status: HealthStatus) => -healthStatuses.indexOf(status)

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

const whoActsOn = (run: FailedRun, waiting: WaitingForTradingPartnerSince | undefined) =>
  whoActsOnFailedRun({ ...run, waitingForTradingPartner: waiting?.has(run.id) ?? false })

function failedRunTasks(
  runs: RunStore,
  waiting: WaitingForTradingPartnerSince | undefined,
  from: number,
) {
  return runs.all().flatMap((run): Task[] =>
    isFailed(run) && Date.parse(run.receivedAt) >= from && runs.replacingOf(run.id) === undefined
      ? [
          {
            id: `run:${run.id}`,
            kind: 'failedRun',
            whoActs: whoActsOn(run, waiting),
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

function failingTradingPartnerTasks(
  tradingPartners: ReadonlyArray<TradingPartner>,
  runs: readonly RunSummary[],
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>,
  openFailedRunTasks: readonly Task[],
  from: number,
  now: Date,
) {
  const failedRunTasksOf = Map.groupBy(openFailedRunTasks, (task) => task.tradingPartner.id)

  return tradingPartnerHealthOf(tradingPartners, runs, overdueAcknowledgements, from).flatMap(
    (health): Task[] =>
      health.status === 'failing'
        ? [
            {
              id: `tradingPartner:${health.tradingPartner.id}`,
              kind: 'failingTradingPartner',
              whoActs: whoActsOnFailingTradingPartner(
                failedRunTasksOf.get(health.tradingPartner.id) ?? [],
              ),
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
  {
    runs,
    tradingPartners,
    overdueAcknowledgements,
    waitingForTradingPartnerSince,
  }: WorkspaceActivity,
  now = new Date(),
): Tasks {
  const from = now.getTime() - tasksLookback
  const store = toRunStore(runs)
  const all = store.all()

  const openFailedRunTasks = failedRunTasks(store, waitingForTradingPartnerSince, from)

  const tasks = [
    ...openFailedRunTasks,
    ...overdueAcknowledgementTasks(overdueAcknowledgements),
    ...failingTradingPartnerTasks(
      tradingPartners,
      all,
      overdueAcknowledgements,
      openFailedRunTasks,
      from,
      now,
    ),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))

  return tasksSchema.parse({ tasks, counts: taskCountsOf(tasks) })
}

export function tasksHandler(apiUrl: string, source?: WorkspaceActivity | WorkspaceActivityState) {
  return workspaceActivityHandler(`${apiUrl}${tasksEndpoint.path}`, source, (activity) =>
    HttpResponse.json(toTasks(activity)),
  )
}
