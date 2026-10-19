import { and, asc, count, desc, eq, gte, inArray, lte, or, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { SelectedFields } from 'drizzle-orm/pg-core'

import {
  directionOf,
  type FailureStage,
  type ProblemReason,
  type RunDetail,
  type RunList,
  type RunListQuery,
  type RunStatus,
  runStatuses,
  type RunSummary,
  whoFixes,
} from '@edi-bridge/contracts'
import { flows, mappingVersions, runs, runSteps, tradingPartners } from '@edi-bridge/db'
import { Database as PipelineDatabase, retryRun as retryDelivery } from '@edi-bridge/pipeline'

import { Db, type Database } from './db.js'
import { Conflict, NotFound } from './errors.js'
import { selectVersions, toHeader } from './mapping-version.js'
import { inWorkspace, rejectingInvalidId } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

const summaryFields = {
  id: runs.id,
  receivedAt: runs.receivedAt,
  status: runs.status,
  failureStage: runs.failureStage,
  problem: runs.problem,
  manualSubmission: runs.manualSubmission,
  businessReference: runs.businessReference,
  tradingPartnerId: tradingPartners.id,
  tradingPartnerName: tradingPartners.name,
  flowId: flows.id,
  flowName: flows.name,
  messageType: flows.messageType,
}

// Drizzle types the joins only with a known field; the list and its counts both select the status.
const fromRuns = <Fields extends SelectedFields>(db: Database, fields: Fields) =>
  db
    .select({ status: runs.status, ...fields })
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))

const selectRuns = <Fields extends SelectedFields>(db: Database, fields: Fields) =>
  fromRuns(db, { ...summaryFields, ...fields })

type SummaryRow = Awaited<ReturnType<typeof selectRuns<Record<never, never>>>>[number]

type Outcome =
  | { status: 'failed'; failureStage: FailureStage; problem: { reason: ProblemReason } }
  | { status: Exclude<RunStatus, 'failed'>; failureStage: null; problem: null }

// The database sets a Failure Stage and a problem exactly on a failed Run.
const outcomeOf = ({ id, status, failureStage, problem }: SummaryRow): Outcome => {
  if (status === 'failed' && failureStage !== null && problem !== null) {
    return { status, failureStage, problem: { reason: problem.reason } }
  }

  if (status !== 'failed' && failureStage === null) {
    return { status, failureStage, problem: null }
  }

  throw new Error(
    `Run ${id} has status ${status} with Failure Stage ${String(failureStage)} and ${problem === null ? 'no problem' : 'a problem'}`,
  )
}

const toSummary = (row: SummaryRow): RunSummary => ({
  id: row.id,
  receivedAt: row.receivedAt.toISOString(),
  tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
  messageType: row.messageType,
  direction: directionOf(row),
  flow: { id: row.flowId, name: row.flowName },
  manualSubmission: row.manualSubmission,
  businessReference: row.businessReference,
  // Interchanges are recorded once inbound Runs are processed.
  interchange: null,
  ...outcomeOf(row),
})

export const listRunSummaries = async (db: Database, ids: readonly string[]) => {
  if (ids.length === 0) {
    return []
  }

  const rows = await selectRuns(db, {}).where(inArray(runs.id, [...ids]))

  return ids.flatMap((id) => rows.filter((row) => row.id === id).map(toSummary))
}

// A Run not yet processed will be mapped with the Mapping Version its Flow pins.
const mappingVersionOfRun = sql`coalesce(${runs.mappingVersionId}, ${flows.mappingVersionId})`

const filtersExceptStatus = (db: Database, workspaceId: string, query: RunListQuery) => {
  const text = query.q?.toLowerCase() ?? ''

  return inWorkspace(
    runs,
    workspaceId,
    query.failureStage?.length ? inArray(runs.failureStage, query.failureStage) : undefined,
    query.tradingPartnerId?.length
      ? inArray(runs.tradingPartnerId, query.tradingPartnerId)
      : undefined,
    query.messageType?.length ? inArray(flows.messageType, query.messageType) : undefined,
    query.flowId?.length ? inArray(runs.flowId, query.flowId) : undefined,
    query.mappingId?.length
      ? inArray(
          mappingVersionOfRun,
          db
            .select({ id: mappingVersions.id })
            .from(mappingVersions)
            .where(inArray(mappingVersions.mappingId, query.mappingId)),
        )
      : undefined,
    query.receivedFrom === undefined
      ? undefined
      : gte(runs.receivedAt, new Date(query.receivedFrom)),
    query.receivedTo === undefined ? undefined : lte(runs.receivedAt, new Date(query.receivedTo)),
    query.manualSubmission === undefined
      ? undefined
      : eq(runs.manualSubmission, query.manualSubmission),
    text === ''
      ? undefined
      : or(
          sql`strpos(lower(${runs.businessReference}), ${text}) > 0`,
          sql`strpos(lower(${tradingPartners.name}), ${text}) > 0`,
        ),
  )
}

export const listRuns = (query: RunListQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const matching = filtersExceptStatus(db, workspace.id, query)

    const where: SQL | undefined = query.status?.length
      ? and(matching, inArray(runs.status, query.status))
      : matching

    const [rows, counted] = yield* Effect.promise(() =>
      Promise.all([
        selectRuns(db, {})
          .where(where)
          .orderBy(desc(runs.receivedAt), desc(runs.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        fromRuns(db, { count: count() }).where(matching).groupBy(runs.status),
      ]),
    )

    const countOf = (status: RunStatus) => counted.find((row) => row.status === status)?.count ?? 0

    // SAFETY: the entries cover every status of runStatuses.
    const statusCounts = Object.fromEntries(
      runStatuses.map((status) => [status, countOf(status)]),
    ) as Record<RunStatus, number>

    const total = runStatuses
      .filter((status) => !query.status?.length || query.status.includes(status))
      .reduce((sum, status) => sum + statusCounts[status], 0)

    return {
      runs: rows.map(toSummary),
      statusCounts,
      total,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies RunList
  })

export const loadRun = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      selectRuns(db, {
        mappingVersionId: runs.mappingVersionId,
        error: runs.error,
        waitingForTradingPartnerSince: runs.waitingForTradingPartnerSince,
      }).where(inWorkspace(runs, workspace.id, eq(runs.id, id))),
    )

    if (row === undefined) {
      return yield* new NotFound()
    }

    const [steps, [version]] = yield* Effect.promise(() =>
      Promise.all([
        db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.position)),
        row.mappingVersionId === null
          ? Promise.resolve([])
          : selectVersions(db, {}).where(eq(mappingVersions.id, row.mappingVersionId)),
      ]),
    )

    return toDetail(row, {
      steps: steps.map((step) => ({
        stage: step.stage,
        status: step.status,
        startedAt: step.startedAt?.toISOString() ?? null,
        finishedAt: step.finishedAt?.toISOString() ?? null,
      })),
      mappingVersion: version ? toHeader(version) : null,
    })
  })

type DetailRow = SummaryRow & {
  error: (typeof runs.$inferSelect)['error']
  waitingForTradingPartnerSince: Date | null
}

const toDetail = (
  row: DetailRow,
  loaded: Pick<RunDetail, 'steps' | 'mappingVersion'>,
): RunDetail => {
  const summary = toSummary(row)

  const shared = {
    ...summary,
    ...loaded,
    // Interchanges, parsed Messages, Reprocess and Duplicates come with inbound processing.
    interchange: null,
    message: null,
    replaces: null,
    replacedBy: null,
    duplicateOf: null,
  }

  if (summary.status !== 'failed') {
    return {
      ...shared,
      status: summary.status,
      failureStage: null,
      error: null,
      problem: null,
      waitingForTradingPartnerSince: null,
    }
  }

  const fixer = whoFixes(summary)

  if (row.error === null || row.problem === null || fixer === null) {
    throw new Error(`Failed Run ${row.id} has no error or problem`)
  }

  return {
    ...shared,
    status: summary.status,
    failureStage: summary.failureStage,
    error: row.error,
    problem: { ...row.problem, whoFixes: fixer },
    waitingForTradingPartnerSince: row.waitingForTradingPartnerSince?.toISOString() ?? null,
  }
}

export const retryRun = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    yield* loadRun(id)

    yield* retryDelivery({ workspaceId: workspace.id, runId: id }).pipe(
      Effect.provideService(PipelineDatabase, db),
      Effect.catchTag('RunNotRetryable', (error) =>
        Effect.fail(new Conflict({ message: error.message })),
      ),
    )

    return yield* loadRun(id)
  })
