import { and, asc, count, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, unionAll } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'

import {
  type Direction,
  type Interchange,
  type InterchangeList,
  type InterchangeListQuery,
  type InterchangeSummary,
  type RunSummary,
} from '@edi-bridge/contracts'
import { documents, flows, runs, tradingPartners } from '@edi-bridge/db'
import { readInterchange } from '@edi-bridge/edifact'

import { Db, type Database } from './db.js'
import { foundOrNotFound, inWorkspace, rejectingInvalidId } from './rows.js'
import { fromRuns, listRunSummaries, matchingSearchTerm } from './run.js'
import { readableTextOf } from './stored-document.js'
import { CurrentWorkspace, loadCurrentWorkspace } from './workspace.js'

const interchangeFieldsOf = (
  id: AnyPgColumn,
  direction: Direction,
  controlReference: SQL<string>,
  preparedAt: AnyPgColumn,
) => ({
  id: sql<string>`${id}`.as('id'),
  direction: sql<Direction>`${direction}`.as('direction'),
  controlReference: controlReference.as('control_reference'),
  tradingPartnerId: sql<string>`${tradingPartners.id}`.as('trading_partner_id'),
  tradingPartnerName: sql<string>`${tradingPartners.name}`.as('trading_partner_name'),
  preparedAt: sql`${preparedAt}`.mapWith(runs.receivedAt).as('prepared_at'),
})

type Branch = { id: AnyPgColumn; controlReference: SQL<string> }

type BranchCondition = (branch: Branch) => SQL | undefined

const outboundBranch = {
  id: runs.id,
  controlReference: sql<string>`${runs.controlReference}::text`,
}

// An outbound Run the Channel took is its own Interchange, so the Run id names it.
const outboundInterchangeRuns = (db: Database, workspaceId: string, condition: BranchCondition) =>
  fromRuns(
    db,
    interchangeFieldsOf(
      outboundBranch.id,
      'outbound',
      outboundBranch.controlReference,
      runs.handedOverAt,
    ),
  ).where(
    inWorkspace(
      runs,
      workspaceId,
      isNotNull(runs.handedOverAt),
      isNotNull(runs.controlReference),
      isNotNull(runs.output),
      condition(outboundBranch),
    ),
  )

const inboundBranch = {
  id: documents.id,
  controlReference: sql<string>`${documents.interchangeControlReference}`,
}

// A received Interchange is its stored Document, so the Document id names it.
const inboundInterchangeRuns = (db: Database, workspaceId: string, condition: BranchCondition) =>
  fromRuns(
    db,
    interchangeFieldsOf(
      inboundBranch.id,
      'inbound',
      inboundBranch.controlReference,
      documents.receivedAt,
    ),
  )
    .innerJoin(documents, eq(documents.id, runs.documentId))
    .where(
      inWorkspace(
        documents,
        workspaceId,
        isNotNull(documents.interchangeControlReference),
        condition(inboundBranch),
      ),
    )

// Distinct, since a branch yields a row per matching Run and a received Interchange may have several.
const interchangesOf = (db: Database, workspaceId: string, condition: BranchCondition) => {
  const interchangeRuns = unionAll(
    outboundInterchangeRuns(db, workspaceId, condition),
    inboundInterchangeRuns(db, workspaceId, condition),
  ).as('interchange_runs')

  return db
    .selectDistinct({
      id: interchangeRuns.id,
      direction: interchangeRuns.direction,
      controlReference: interchangeRuns.controlReference,
      tradingPartnerId: interchangeRuns.tradingPartnerId,
      tradingPartnerName: interchangeRuns.tradingPartnerName,
      preparedAt: interchangeRuns.preparedAt,
    })
    .from(interchangeRuns)
}

const matching =
  (query: InterchangeListQuery): BranchCondition =>
  ({ controlReference }) =>
    and(
      query.tradingPartnerId?.length
        ? inArray(runs.tradingPartnerId, query.tradingPartnerId)
        : undefined,
      query.messageType?.length ? inArray(flows.messageType, query.messageType) : undefined,
      matchingSearchTerm(query.q, controlReference),
    )

type InterchangeRow = Awaited<ReturnType<typeof interchangesOf>>[number]

const listRunsOf = async (db: Database, interchanges: readonly InterchangeRow[]) => {
  const outbound = interchanges.filter(({ direction }) => direction === 'outbound')
  const inbound = interchanges.filter(({ direction }) => direction === 'inbound')

  const received =
    inbound.length === 0
      ? []
      : await db
          .select({ id: runs.id, documentId: runs.documentId })
          .from(runs)
          .where(
            inArray(
              runs.documentId,
              inbound.map(({ id }) => id),
            ),
          )
          // By arrival first, so a Reprocess comes after the Runs of the received Messages.
          .orderBy(asc(runs.receivedAt), asc(runs.messageIndex), asc(runs.id))

  const runIdsOf = (interchange: InterchangeRow) =>
    interchange.direction === 'outbound'
      ? [interchange.id]
      : received.filter(({ documentId }) => documentId === interchange.id).map(({ id }) => id)

  const summaries = await listRunSummaries(db, [
    ...outbound.map(({ id }) => id),
    ...received.map(({ id }) => id),
  ])

  return (interchange: InterchangeRow): RunSummary[] =>
    runIdsOf(interchange).flatMap((runId) => summaries.filter(({ id }) => id === runId))
}

const toSummary =
  (runsOf: (interchange: InterchangeRow) => RunSummary[]) =>
  (row: InterchangeRow): InterchangeSummary => {
    const interchangeRuns = runsOf(row)

    if (interchangeRuns.length === 0) {
      throw new Error(`Interchange ${row.id} has no Run`)
    }

    return {
      id: row.id,
      controlReference: row.controlReference,
      direction: row.direction,
      tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
      preparedAt: row.preparedAt.toISOString(),
      runs: interchangeRuns,
    }
  }

export const listInterchanges = (query: InterchangeListQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [rows, [counted]] = yield* Effect.promise(() =>
      Promise.all([
        interchangesOf(db, workspace.id, matching(query))
          .orderBy(desc(sql`prepared_at`), desc(sql`id`))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db
          .select({ count: count() })
          .from(interchangesOf(db, workspace.id, matching(query)).as('interchanges')),
      ]),
    )

    const runsOf = yield* Effect.promise(() => listRunsOf(db, rows))

    return {
      interchanges: rows.map(toSummary(runsOf)),
      total: counted?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    } satisfies InterchangeList
  })

const rawOf = async (db: Database, { id, direction }: InterchangeRow) => {
  if (direction === 'inbound') {
    const [document] = await db
      .select({ id: documents.id, content: documents.content, bytes: documents.bytes })
      .from(documents)
      .where(eq(documents.id, id))

    return document && readableTextOf(document)
  }

  const [run] = await db.select({ output: runs.output }).from(runs).where(eq(runs.id, id))

  return run?.output ?? undefined
}

const presentOrThrow = (value: string | undefined, missing: string) => {
  if (value === undefined || value === '') {
    throw new Error(missing)
  }

  return value
}

export const loadInterchange = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const row = yield* Effect.flatMap(
      Effect.promise(() => interchangesOf(db, workspace.id, (branch) => eq(branch.id, id))),
      ([found]) => foundOrNotFound(found),
    )

    const own = yield* loadCurrentWorkspace

    const [raw, runsOf, messageIndexes] = yield* Effect.promise(() =>
      Promise.all([
        rawOf(db, row),
        listRunsOf(db, [row]),
        db
          .select({ id: runs.id, messageIndex: runs.messageIndex })
          .from(runs)
          .where(row.direction === 'outbound' ? eq(runs.id, id) : eq(runs.documentId, id)),
      ]),
    )

    if (raw === undefined) {
      throw new Error(`Interchange ${id} has no raw text`)
    }

    // Receipt read the keys from this header, so it reads again though a later segment breaks.
    const { header, messages } = readInterchange(raw)
    const tradingPartner = { name: row.tradingPartnerName }
    const ownCompany = { name: own.name }

    const sender = {
      identification: presentOrThrow(header?.elements[1]?.[0], `Interchange ${id} has no sender`),
    }

    const receiver = {
      identification: presentOrThrow(header?.elements[2]?.[0], `Interchange ${id} has no receiver`),
    }

    // An outbound Run, a test send too, has no Message Index: its Interchange holds one Message.
    const onlyMessage = 1

    const messageReferenceOf = (runId: string) => {
      const messageIndex =
        messageIndexes.find((run) => run.id === runId)?.messageIndex ?? onlyMessage

      const reference = messages[messageIndex - 1]?.message.header.elements[0]?.[0]

      return reference === undefined || reference === '' ? null : reference
    }

    return {
      id: row.id,
      controlReference: row.controlReference,
      direction: row.direction,
      ...(row.direction === 'outbound'
        ? {
            sender: { ...sender, ...ownCompany },
            receiver: { ...receiver, ...tradingPartner },
          }
        : {
            sender: { ...sender, ...tradingPartner },
            receiver: { ...receiver, ...ownCompany },
          }),
      raw,
      runs: runsOf(row).map((run) => ({ ...run, messageReference: messageReferenceOf(run.id) })),
    } satisfies Interchange
  })
