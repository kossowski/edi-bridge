import { asc, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'

import {
  businessReferenceSchema,
  directionOf,
  type OrderLifecycle,
  type OrderLifecycleInterchange,
  type OrderLifecycleList,
  type OrderLifecycleListQuery,
  type OrderLifecycleMessage,
  orderLifecycleMessageTypes,
  type OrderLifecycleRun,
  type OrderLifecycleStatus,
  orderLifecycleStatuses,
  toOrderLifecycleSummary,
} from '@edi-bridge/contracts'
import { acknowledgements, documents, flows, runs, tradingPartners } from '@edi-bridge/db'

import { Db, type Database } from './db.js'
import { parse } from './parse.js'
import { byName, inWorkspace } from './rows.js'
import { businessReferenceOfRun, originalRuns } from './run.js'
import { CurrentWorkspace } from './workspace.js'

const replacingRuns = alias(runs, 'replacing_runs')

const selectLifecycleRuns = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: runs.id,
      receivedAt: runs.receivedAt,
      status: runs.status,
      failureStage: runs.failureStage,
      waitingForTradingPartnerSince: runs.waitingForTradingPartnerSince,
      businessReference: businessReferenceOfRun,
      messageType: flows.messageType,
      tradingPartnerId: tradingPartners.id,
      tradingPartnerName: tradingPartners.name,
      acknowledgementTimeLimitHours: tradingPartners.acknowledgementTimeLimitHours,
      controlReference: runs.controlReference,
      acknowledgementState: runs.acknowledgementState,
      documentId: runs.documentId,
      receivedControlReference: documents.interchangeControlReference,
      notSentReason: acknowledgements.notSentReason,
      replacedById: replacingRuns.id,
    })
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .innerJoin(documents, eq(documents.id, runs.documentId))
    .leftJoin(originalRuns, eq(originalRuns.id, runs.duplicateOfRunId))
    .leftJoin(acknowledgements, eq(acknowledgements.documentId, runs.documentId))
    .leftJoin(replacingRuns, eq(replacingRuns.replacesRunId, runs.id))
    .where(where)
    .orderBy(asc(runs.receivedAt), asc(runs.id))

type LifecycleRow = Awaited<ReturnType<typeof selectLifecycleRuns>>[number]

const lifecycleRunsInWorkspace = (workspaceId: string, condition: SQL | undefined) =>
  inWorkspace(
    runs,
    workspaceId,
    inArray(flows.messageType, [...orderLifecycleMessageTypes]),
    isNotNull(businessReferenceOfRun),
    condition,
  )

const runOf = (row: LifecycleRow): OrderLifecycleRun => {
  const replacedBy = row.replacedById === null ? null : { id: row.replacedById }

  if (row.status === 'failed' && row.failureStage !== null) {
    return {
      id: row.id,
      replacedBy,
      status: row.status,
      failureStage: row.failureStage,
      waitingForTradingPartnerSince: row.waitingForTradingPartnerSince?.toISOString() ?? null,
    }
  }

  if (row.status !== 'failed') {
    return {
      id: row.id,
      replacedBy,
      status: row.status,
      failureStage: null,
      waitingForTradingPartnerSince: null,
    }
  }

  throw new Error(`Failed Run ${row.id} has no Failure Stage`)
}

// The Run names its sent Interchange; a received one is the Document the Trading Partner sent.
const interchangeOf = (
  row: LifecycleRow,
  direction: OrderLifecycleMessage['direction'],
): OrderLifecycleInterchange | null => {
  if (direction === 'outbound') {
    return row.controlReference === null
      ? null
      : {
          id: row.id,
          controlReference: String(row.controlReference),
          acknowledgement: row.acknowledgementState,
          notSentReason: null,
        }
  }

  return row.receivedControlReference === null
    ? null
    : {
        id: row.documentId,
        controlReference: row.receivedControlReference,
        acknowledgement: null,
        notSentReason: row.notSentReason,
      }
}

const messageOf = (row: LifecycleRow): OrderLifecycleMessage => {
  const direction = directionOf(row)

  return {
    // SAFETY: the query selects only the Message Types of the Order Lifecycle.
    messageType: row.messageType as OrderLifecycleMessage['messageType'],
    direction,
    receivedAt: row.receivedAt.toISOString(),
    run: runOf(row),
    interchange: interchangeOf(row, direction),
  }
}

// The rows come oldest first, so each Order Lifecycle lists its Messages oldest first.
const lifecyclesOf = (rows: readonly LifecycleRow[]): OrderLifecycle[] =>
  [
    ...Map.groupBy(rows, (row) => `${row.businessReference}\u0000${row.tradingPartnerId}`).values(),
  ].map((group) => {
    const first = group[0]!

    return {
      // SAFETY: the query selects only Runs with a Business Reference.
      businessReference: first.businessReference as string,
      tradingPartner: {
        id: first.tradingPartnerId,
        name: first.tradingPartnerName,
        acknowledgementTimeLimitHours: first.acknowledgementTimeLimitHours,
      },
      messages: group.map(messageOf),
    }
  })

const noStatuses = (): Record<OrderLifecycleStatus, number> =>
  // SAFETY: the entries cover every status of orderLifecycleStatuses.
  Object.fromEntries(orderLifecycleStatuses.map((status) => [status, 0])) as Record<
    OrderLifecycleStatus,
    number
  >

export const listOrderLifecycles = (query: OrderLifecycleListQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const text = query.q?.toLowerCase() ?? ''

    // A search term matches the Business Reference or Trading Partner every Run of a lifecycle shares.
    const rows = yield* Effect.promise(() =>
      selectLifecycleRuns(
        db,
        lifecycleRunsInWorkspace(
          workspace.id,
          text === ''
            ? undefined
            : or(
                sql`strpos(lower(${businessReferenceOfRun}), ${text}) > 0`,
                sql`strpos(lower(${tradingPartners.name}), ${text}) > 0`,
              ),
        ),
      ),
    )

    const searched = lifecyclesOf(rows).map(toOrderLifecycleSummary)

    const statusCounts = noStatuses()

    for (const { status } of searched) {
      statusCounts[status] += 1
    }

    const filtered = searched
      .filter(({ status }) => !query.status?.length || query.status.includes(status))
      .toSorted(
        (a, b) =>
          Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) ||
          a.businessReference.localeCompare(b.businessReference) ||
          byName(a.tradingPartner, b.tradingPartner),
      )

    const start = (query.page - 1) * query.pageSize

    return {
      orderLifecycles: filtered.slice(start, start + query.pageSize),
      statusCounts,
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies OrderLifecycleList
  })

export const loadOrderLifecycles = (businessReference: string) =>
  Effect.gen(function* () {
    const reference = yield* parse(businessReferenceSchema, businessReference)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      selectLifecycleRuns(
        db,
        lifecycleRunsInWorkspace(workspace.id, sql`${businessReferenceOfRun} = ${reference}`),
      ),
    )

    return lifecyclesOf(rows).toSorted((a, b) => byName(a.tradingPartner, b.tradingPartner))
  })
