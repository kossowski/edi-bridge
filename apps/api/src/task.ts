import { and, eq, gte, inArray, max, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Clock, Effect } from 'effect'

import {
  healthStatusOf,
  type MessageType,
  overdueAcknowledgementMessageTypes,
  type Task,
  taskCountsOf,
  type Tasks,
  whoActsOnFailedRun,
  whoActsOnFailingTradingPartner,
} from '@edi-bridge/contracts'
import { flows, runs, tradingPartners } from '@edi-bridge/db'

import { Db, type Database } from './db.js'
import { dayMs, hourMs } from './duration.js'
import { inWorkspace } from './rows.js'
import { failureOf, fromRuns } from './run.js'
import { CurrentWorkspace } from './workspace.js'

const replacingRuns = alias(runs, 'replacing_runs')

const listFailedRuns = (db: Database, workspaceId: string, from: Date) =>
  fromRuns(db, {
    id: runs.id,
    failureStage: runs.failureStage,
    receivedAt: runs.receivedAt,
    waitingForTradingPartnerSince: runs.waitingForTradingPartnerSince,
    messageType: flows.messageType,
    tradingPartnerId: tradingPartners.id,
    tradingPartnerName: tradingPartners.name,
  }).where(
    inWorkspace(
      runs,
      workspaceId,
      eq(runs.status, 'failed'),
      gte(runs.receivedAt, from),
      notExists(
        db
          .select({ id: replacingRuns.id })
          .from(replacingRuns)
          .where(eq(replacingRuns.replacesRunId, runs.id)),
      ),
    ),
  )

type FailedRunRow = Awaited<ReturnType<typeof listFailedRuns>>[number]

// The query selects failed Runs only; the status check narrows the failure to read its stage.
const toFailedRunTask = (row: FailedRunRow): Task[] => {
  const failure = failureOf(row)

  if (failure.status !== 'failed') {
    return []
  }

  return [
    {
      id: `run:${row.id}`,
      kind: 'failedRun',
      whoActs: whoActsOnFailedRun({
        failureStage: failure.failureStage,
        messageType: row.messageType,
        waitingForTradingPartner: row.waitingForTradingPartnerSince !== null,
      }),
      tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
      at: row.receivedAt.toISOString(),
      run: { id: row.id, messageType: row.messageType, failureStage: failure.failureStage },
      target: { kind: 'run', runId: row.id },
    },
  ]
}

const listOverdueInterchanges = (db: Database, workspaceId: string) =>
  fromRuns(db, {
    id: runs.id,
    handedOverAt: runs.handedOverAt,
    controlReference: runs.controlReference,
    messageType: flows.messageType,
    tradingPartnerId: tradingPartners.id,
    tradingPartnerName: tradingPartners.name,
    acknowledgementTimeLimitHours: tradingPartners.acknowledgementTimeLimitHours,
  }).where(
    inWorkspace(
      runs,
      workspaceId,
      eq(runs.acknowledgementState, 'overdue'),
      inArray(flows.messageType, [...overdueAcknowledgementMessageTypes]),
    ),
  )

type OverdueInterchangeRow = Awaited<ReturnType<typeof listOverdueInterchanges>>[number]

const isOverdueAcknowledgementMessageType = (
  messageType: MessageType,
): messageType is (typeof overdueAcknowledgementMessageTypes)[number] =>
  overdueAcknowledgementMessageTypes.some((type) => type === messageType)

// The database sets a handover and a control reference on every Interchange with an Acknowledgement state.
const toOverdueAcknowledgementTask = (row: OverdueInterchangeRow): Task[] => {
  const { handedOverAt, controlReference, messageType } = row

  if (
    handedOverAt === null ||
    controlReference === null ||
    !isOverdueAcknowledgementMessageType(messageType)
  ) {
    return []
  }

  const interchange = { id: row.id, controlReference: String(controlReference) }

  return [
    {
      id: `overdue:${row.id}`,
      kind: 'overdueAcknowledgement',
      whoActs: 'tradingPartner',
      tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
      // No overdue-since time is stored, so the deadline marks when the Interchange became overdue.
      at: new Date(
        handedOverAt.getTime() + row.acknowledgementTimeLimitHours * hourMs,
      ).toISOString(),
      interchange,
      messageType,
      sentAt: handedOverAt.toISOString(),
      acknowledgementTimeLimitHours: row.acknowledgementTimeLimitHours,
      target: { kind: 'interchange', controlReference: interchange.controlReference },
    },
  ]
}

const finishedSince = (status: 'delivered' | 'failed', from: Date) =>
  sql<number>`count(*) filter (where ${and(eq(runs.status, status), gte(runs.receivedAt, from))})`.mapWith(
    Number,
  )

const countRecentRunsByTradingPartner = (db: Database, workspaceId: string, from: Date) =>
  db
    .select({
      tradingPartnerId: tradingPartners.id,
      tradingPartnerName: tradingPartners.name,
      delivered: finishedSince('delivered', from),
      failed: finishedSince('failed', from),
      lastRunAt: max(runs.receivedAt),
    })
    .from(runs)
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .where(inWorkspace(runs, workspaceId))
    .groupBy(tradingPartners.id)

type RecentRunCountsRow = Awaited<ReturnType<typeof countRecentRunsByTradingPartner>>[number]

const toFailingTradingPartnerTask =
  (failedRunTasks: readonly Task[], overdueTasks: readonly Task[], now: Date) =>
  (row: RecentRunCountsRow): Task[] => {
    const ofTradingPartner = (task: Task) => task.tradingPartner.id === row.tradingPartnerId
    const overdue = overdueTasks.filter(ofTradingPartner).length

    if (healthStatusOf({ delivered: row.delivered, failed: row.failed, overdue }) !== 'failing') {
      return []
    }

    return [
      {
        id: `tradingPartner:${row.tradingPartnerId}`,
        kind: 'failingTradingPartner',
        whoActs: whoActsOnFailingTradingPartner(failedRunTasks.filter(ofTradingPartner)),
        tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
        at: (row.lastRunAt ?? now).toISOString(),
        delivered: row.delivered,
        failed: row.failed,
        target: { kind: 'tradingPartner', tradingPartnerId: row.tradingPartnerId },
      },
    ]
  }

const newestFirst = (a: Task, b: Task) =>
  Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)

export const listTasks = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace
  const now = new Date(yield* Clock.currentTimeMillis)
  const from = new Date(now.getTime() - dayMs)

  const [failedRuns, overdueInterchanges, activity] = yield* Effect.promise(() =>
    Promise.all([
      listFailedRuns(db, workspace.id, from),
      listOverdueInterchanges(db, workspace.id),
      countRecentRunsByTradingPartner(db, workspace.id, from),
    ]),
  )

  const failedRunTasks = failedRuns.flatMap(toFailedRunTask)
  const overdueTasks = overdueInterchanges.flatMap(toOverdueAcknowledgementTask)

  const tasks = [
    ...failedRunTasks,
    ...overdueTasks,
    ...activity.flatMap(toFailingTradingPartnerTask(failedRunTasks, overdueTasks, now)),
  ].sort(newestFirst)

  return { tasks, counts: taskCountsOf(tasks) } satisfies Tasks
})
