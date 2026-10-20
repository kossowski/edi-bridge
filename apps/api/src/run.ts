import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  notExists,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias, type SelectedFields } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'

import {
  directionOf,
  type FailureStage,
  type ProblemReason,
  type ReprocessRunBody,
  type RunDetail,
  type RunList,
  type RunListQuery,
  type RunStatus,
  runStatuses,
  type RunSummary,
  whoFixes,
} from '@edi-bridge/contracts'
import { flows, mappingVersions, runs, runSteps, tradingPartners } from '@edi-bridge/db'
import {
  isFixedByReprocess,
  Database as PipelineDatabase,
  publishRunChanges,
  reprocessRun as reprocessInPipeline,
  retryRun as retryDelivery,
} from '@edi-bridge/pipeline'

import { Db, type Database } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { selectVersions, toHeader } from './mapping-version.js'
import { inWorkspace, rejectingInvalidId } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

// A Duplicate is never mapped, so it shows the Business Reference of its original Run.
const originalRuns = alias(runs, 'original_runs')

export const businessReferenceOfRun = sql<
  string | null
>`coalesce(${runs.businessReference}, ${originalRuns.businessReference})`

const summaryFields = {
  id: runs.id,
  receivedAt: runs.receivedAt,
  status: runs.status,
  failureStage: runs.failureStage,
  problem: runs.problem,
  manualSubmission: runs.manualSubmission,
  businessReference: businessReferenceOfRun,
  tradingPartnerId: tradingPartners.id,
  tradingPartnerName: tradingPartners.name,
  flowId: flows.id,
  flowName: flows.name,
  messageType: flows.messageType,
}

// Drizzle types the joins only with a known field; the list and its counts both select the status.
export const fromRuns = <Fields extends SelectedFields>(db: Database, fields: Fields) =>
  db
    .select({ status: runs.status, ...fields })
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .leftJoin(originalRuns, eq(originalRuns.id, runs.duplicateOfRunId))

const selectRuns = <Fields extends SelectedFields>(db: Database, fields: Fields) =>
  fromRuns(db, { ...summaryFields, ...fields })

type SummaryRow = Awaited<ReturnType<typeof selectRuns<Record<never, never>>>>[number]

type Failure =
  | { status: 'failed'; failureStage: FailureStage }
  | { status: Exclude<RunStatus, 'failed'>; failureStage: null }

type FailureRow = { id: string; status: RunStatus; failureStage: FailureStage | null }

// The database sets a Failure Stage exactly on a failed Run.
export const failureOf = ({ id, status, failureStage }: FailureRow): Failure => {
  if (status === 'failed' && failureStage !== null) {
    return { status, failureStage }
  }

  if (status !== 'failed' && failureStage === null) {
    return { status, failureStage }
  }

  throw new Error(`Run ${id} has status ${status} with Failure Stage ${String(failureStage)}`)
}

type Outcome =
  | { status: 'failed'; failureStage: FailureStage; problem: { reason: ProblemReason } }
  | { status: Exclude<RunStatus, 'failed'>; failureStage: null; problem: null }

// The database sets a problem exactly on a failed Run.
const outcomeOf = (row: SummaryRow): Outcome => {
  const failure = failureOf(row)

  if (failure.status !== 'failed') {
    return { ...failure, problem: null }
  }

  if (row.problem === null) {
    throw new Error(`Failed Run ${row.id} has no problem`)
  }

  return { ...failure, problem: { reason: row.problem.reason } }
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

export const matchingSearchTerm = (q: string | undefined, ...alsoSearched: SQL[]) => {
  const searchTerm = q?.toLowerCase() ?? ''

  return searchTerm === ''
    ? undefined
    : or(
        ...[businessReferenceOfRun, tradingPartners.name, ...alsoSearched].map(
          (searched) => sql`strpos(lower(${searched}), ${searchTerm}) > 0`,
        ),
      )
}

const filtersExceptStatus = (db: Database, workspaceId: string, query: RunListQuery) =>
  inWorkspace(
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
    matchingSearchTerm(query.q),
  )

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
        replacesRunId: runs.replacesRunId,
        duplicateOfRunId: runs.duplicateOfRunId,
        documentDeletedAt: runs.documentDeletedAt,
      }).where(inWorkspace(runs, workspace.id, eq(runs.id, id))),
    )

    if (row === undefined) {
      return yield* new NotFound()
    }

    const [steps, [version], [replacedBy]] = yield* Effect.promise(() =>
      Promise.all([
        db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.position)),
        row.mappingVersionId === null
          ? Promise.resolve([])
          : selectVersions(db, {}).where(eq(mappingVersions.id, row.mappingVersionId)),
        db.select({ id: runs.id }).from(runs).where(eq(runs.replacesRunId, id)),
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
      replaces: row.replacesRunId === null ? null : { id: row.replacesRunId },
      replacedBy: replacedBy ?? null,
    })
  })

type DetailRow = SummaryRow & {
  error: (typeof runs.$inferSelect)['error']
  waitingForTradingPartnerSince: Date | null
  duplicateOfRunId: string | null
  documentDeletedAt: Date | null
}

const toDetail = (
  row: DetailRow,
  loaded: Pick<RunDetail, 'steps' | 'mappingVersion' | 'replaces' | 'replacedBy'>,
): RunDetail => {
  const summary = toSummary(row)

  const shared = {
    ...summary,
    ...loaded,
    // Interchanges and parsed Messages come with inbound processing.
    interchange: null,
    message: null,
    documentDeletedAt: row.documentDeletedAt?.toISOString() ?? null,
  }

  const unfailed = {
    failureStage: null,
    error: null,
    problem: null,
    waitingForTradingPartnerSince: null,
  }

  if (summary.status === 'duplicate') {
    return {
      ...shared,
      ...unfailed,
      status: summary.status,
      duplicateOf: row.duplicateOfRunId === null ? null : { id: row.duplicateOfRunId },
    }
  }

  if (summary.status !== 'failed') {
    return { ...shared, ...unfailed, status: summary.status, duplicateOf: null }
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
    duplicateOf: null,
  }
}

const reprocessWithVersion = (id: string, mappingVersionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    return yield* reprocessInPipeline({
      workspaceId: workspace.id,
      runId: id,
      mappingVersionId,
    }).pipe(
      Effect.provideService(PipelineDatabase, db),
      Effect.catchTags({
        RunNotReprocessable: (error) => Effect.fail(new Conflict({ message: error.message })),
        MappingVersionNotOfRun: (error) =>
          Effect.fail(new Unprocessable({ message: error.message })),
      }),
    )
  })

export const retryRun = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const run = yield* loadRun(id)

    const candidate = { ...run, mappingVersionId: run.mappingVersion?.id ?? null }

    // Trying a Defect again outside delivery reprocesses the Run with its own Mapping Version.
    // The Reprocess refuses an expired Document with its reason; a Retry at delivery does not read it.
    if (candidate.problem?.reason === 'defect' && isFixedByReprocess(candidate)) {
      yield* reprocessWithVersion(id, candidate.mappingVersionId)

      return yield* loadRun(id)
    }

    yield* retryDelivery({ workspaceId: workspace.id, runId: id }).pipe(
      Effect.provideService(PipelineDatabase, db),
      Effect.catchTag('RunNotRetryable', (error) =>
        Effect.fail(new Conflict({ message: error.message })),
      ),
    )

    return yield* loadRun(id)
  })

const announceChangeOf = (id: string) =>
  Effect.flatMap(Db, (db) =>
    publishRunChanges([id]).pipe(Effect.provideService(PipelineDatabase, db)),
  )

export const waitForTradingPartnerRun = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const run = yield* loadRun(id)

    if (run.problem?.whoFixes !== 'tradingPartner') {
      return yield* new Conflict({
        message: 'Only a Run that the Trading Partner fixes can wait for the Trading Partner',
      })
    }

    if (run.replacedBy !== null) {
      return yield* new Conflict({
        message: 'A Run that another Run replaces cannot wait for the Trading Partner',
      })
    }

    const marked = yield* Effect.promise(() => markWaitingForTradingPartner(db, workspace.id, id))

    // A Retry or a resend can change the Run between the read above and the mark.
    if (!marked) {
      return yield* new Conflict({ message: 'The Run can no longer wait for the Trading Partner' })
    }

    yield* announceChangeOf(id)

    return yield* loadRun(id)
  })

const replacing = alias(runs, 'replacing')

export const markWaitingForTradingPartner = async (
  db: Database,
  workspaceId: string,
  id: string,
) => {
  const marked = await db
    .update(runs)
    .set({
      // A repeated mark keeps the time the wait began.
      waitingForTradingPartnerSince: sql`coalesce(${runs.waitingForTradingPartnerSince}, now())`,
    })
    .where(
      inWorkspace(
        runs,
        workspaceId,
        eq(runs.id, id),
        eq(runs.status, 'failed'),
        notExists(db.select().from(replacing).where(eq(replacing.replacesRunId, runs.id))),
      ),
    )
    .returning({ id: runs.id })

  return marked.length > 0
}

export const endWaitingForTradingPartnerRun = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    yield* loadRun(id)

    const [ended] = yield* Effect.promise(() =>
      db
        .update(runs)
        .set({ waitingForTradingPartnerSince: null })
        .where(
          inWorkspace(
            runs,
            workspace.id,
            eq(runs.id, id),
            isNotNull(runs.waitingForTradingPartnerSince),
          ),
        )
        .returning({ id: runs.id }),
    )

    if (ended === undefined) {
      return yield* new Conflict({
        message: 'Only a Run that waits for the Trading Partner can end its wait',
      })
    }

    yield* announceChangeOf(id)

    return yield* loadRun(id)
  })

export const reprocessRun = (id: string, { mappingVersionId }: ReprocessRunBody) =>
  Effect.gen(function* () {
    yield* loadRun(id)

    const reprocessed = yield* reprocessWithVersion(id, mappingVersionId)

    return yield* loadRun(reprocessed.runId)
  })
