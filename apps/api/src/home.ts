import { count, gte, inArray, lt, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import {
  type Home,
  homeKeyNumbersOf,
  type HomeTradingPartner,
  type HomeQuery,
  homeWindowSizes,
  type Task,
  type ThroughputBucket,
  type TradingPartner,
} from '@edi-bridge/contracts'
import { runs } from '@edi-bridge/db'

import { Db, type Database } from './db.js'
import { minuteMs, startOfUtcDay } from './duration.js'
import { byName, inWorkspace } from './rows.js'
import { listTasks } from './task.js'
import { listTradingPartners } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

// The last bucket holds now, so the chart ends with the running hour or day.
const windowOf = ({ window }: HomeQuery, now: number) => {
  const { durationMinutes, bucketMinutes } = homeWindowSizes[window]
  const bucketMs = bucketMinutes * minuteMs
  const to = Math.floor(now / bucketMs) * bucketMs + bucketMs

  return {
    from: to - durationMinutes * minuteMs,
    to,
    bucketMs,
    buckets: durationMinutes / bucketMinutes,
  }
}

type Window = ReturnType<typeof windowOf>

const finished = (status: 'delivered' | 'failed') =>
  sql<number>`count(*) filter (where ${runs.status} = ${status})`.mapWith(Number)

const countFinishedRunsByBucket = (
  db: Database,
  workspaceId: string,
  { from, to, bucketMs }: Window,
) => {
  const bucket =
    sql<number>`floor((extract(epoch from ${runs.receivedAt}) * 1000 - ${from}::double precision) / ${bucketMs}::double precision)`.mapWith(
      Number,
    )

  return (
    db
      .select({ bucket, delivered: finished('delivered'), failed: finished('failed') })
      .from(runs)
      .where(
        inWorkspace(
          runs,
          workspaceId,
          inArray(runs.status, ['delivered', 'failed']),
          gte(runs.receivedAt, new Date(from)),
          lt(runs.receivedAt, new Date(to)),
        ),
      )
      // Grouped by position: a repeated expression binds new parameters Postgres can't match.
      .groupBy(sql`1`)
  )
}

const countRunsInProgress = (db: Database, workspaceId: string) =>
  db
    .select({ count: count() })
    .from(runs)
    .where(inWorkspace(runs, workspaceId, inArray(runs.status, ['received', 'processing'])))

const countRunsTodayByTradingPartner = (db: Database, workspaceId: string, startOfToday: Date) =>
  db
    .select({ tradingPartnerId: runs.tradingPartnerId, count: count() })
    .from(runs)
    .where(inWorkspace(runs, workspaceId, gte(runs.receivedAt, startOfToday)))
    .groupBy(runs.tradingPartnerId)

const tradingPartnerCardsOf = (
  tradingPartners: readonly TradingPartner[],
  runsToday: ReadonlyArray<{ tradingPartnerId: string | null; count: number }>,
  tasks: readonly Task[],
): HomeTradingPartner[] => {
  const documentsToday = new Map(runsToday.map((row) => [row.tradingPartnerId, row.count]))
  const openProblems = Map.groupBy(tasks, (task) => task.tradingPartner.id)

  return tradingPartners
    .map(({ id, name, testMode }) => ({
      tradingPartner: { id, name },
      testMode,
      documentsToday: documentsToday.get(id) ?? 0,
      openProblems: openProblems.get(id)?.length ?? 0,
    }))
    .toSorted(
      (a, b) =>
        b.openProblems - a.openProblems ||
        b.documentsToday - a.documentsToday ||
        byName(a.tradingPartner, b.tradingPartner),
    )
}

const throughputOf = (
  window: Window,
  rows: ReadonlyArray<{ bucket: number; delivered: number; failed: number }>,
): ThroughputBucket[] => {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]))

  return Array.from({ length: window.buckets }, (_, index) => ({
    start: new Date(window.from + index * window.bucketMs).toISOString(),
    end: new Date(window.from + (index + 1) * window.bucketMs).toISOString(),
    delivered: byBucket.get(index)?.delivered ?? 0,
    failed: byBucket.get(index)?.failed ?? 0,
  }))
}

export const loadHome = (query: HomeQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace
    const now = yield* Clock.currentTimeMillis
    const window = windowOf(query, now)
    const startOfToday = startOfUtcDay(now)

    const [{ tasks, counts }, tradingPartners, [bucketRows, [inProgress], runsToday]] =
      yield* Effect.all([
        listTasks,
        listTradingPartners,
        Effect.promise(() =>
          Promise.all([
            countFinishedRunsByBucket(db, workspace.id, window),
            countRunsInProgress(db, workspace.id),
            countRunsTodayByTradingPartner(db, workspace.id, startOfToday),
          ]),
        ),
      ])

    const throughput = throughputOf(window, bucketRows)

    return {
      window: query.window,
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
      keyNumbers: homeKeyNumbersOf(counts, {
        delivered: throughput.reduce((sum, bucket) => sum + bucket.delivered, 0),
        inProgress: inProgress?.count ?? 0,
      }),
      throughput,
      tradingPartners: tradingPartnerCardsOf(tradingPartners, runsToday, tasks),
    } satisfies Home
  })
