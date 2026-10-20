import { and, asc, count, desc, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { alias, type AnyPgColumn, unionAll } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'

import {
  type Direction,
  type Interchange,
  type InterchangeList,
  type InterchangeListQuery,
  type InterchangeSummary,
  type RunSummary,
} from '@edi-bridge/contracts'
import { documents, flows, runs, tradingPartners, workspaces } from '@edi-bridge/db'
import { parseMessages } from '@edi-bridge/edifact'

import { Db, type Database } from './db.js'
import { foundOrNotFound, rejectingInvalidId } from './rows.js'
import { listRunSummaries } from './run.js'
import { CurrentWorkspace } from './workspace.js'

// A Duplicate is never mapped, so it is found by the Business Reference of its original Run.
const originalRuns = alias(runs, 'original_runs')

const businessReference = sql`coalesce(${runs.businessReference}, ${originalRuns.businessReference})`

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

const fromInterchangeRuns = (db: Database, fields: ReturnType<typeof interchangeFieldsOf>) =>
  db
    .select(fields)
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .leftJoin(originalRuns, eq(originalRuns.id, runs.duplicateOfRunId))

// A search term matches the control reference, the Trading Partner or a Business Reference.
const matchingSearchTerm = (controlReference: SQL, q: string | undefined) => {
  const searchTerm = q?.toLowerCase() ?? ''

  return searchTerm === ''
    ? undefined
    : or(
        sql`strpos(lower(${controlReference}), ${searchTerm}) > 0`,
        sql`strpos(lower(${tradingPartners.name}), ${searchTerm}) > 0`,
        sql`strpos(lower(${businessReference}), ${searchTerm}) > 0`,
      )
}

const matching = (controlReference: SQL, query: InterchangeListQuery) =>
  and(
    query.tradingPartnerId?.length
      ? inArray(runs.tradingPartnerId, query.tradingPartnerId)
      : undefined,
    query.messageType?.length ? inArray(flows.messageType, query.messageType) : undefined,
    matchingSearchTerm(controlReference, query.q),
  )

const outboundControlReference = sql<string>`${runs.controlReference}::text`

// An outbound Run the Channel took is its own Interchange, so the Run id names it.
const outboundInterchanges = (db: Database, workspaceId: string, query: InterchangeListQuery) =>
  fromInterchangeRuns(
    db,
    interchangeFieldsOf(runs.id, 'outbound', outboundControlReference, runs.handedOverAt),
  ).where(
    and(
      eq(runs.workspaceId, workspaceId),
      isNotNull(runs.handedOverAt),
      isNotNull(runs.controlReference),
      isNotNull(runs.output),
      matching(outboundControlReference, query),
    ),
  )

const inboundControlReference = sql<string>`${documents.interchangeControlReference}`

// A received Interchange is its stored Document, so the Document id names it.
const inboundInterchanges = (db: Database, workspaceId: string, query: InterchangeListQuery) =>
  fromInterchangeRuns(
    db,
    interchangeFieldsOf(documents.id, 'inbound', inboundControlReference, documents.receivedAt),
  )
    .innerJoin(documents, eq(documents.id, runs.documentId))
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNotNull(documents.interchangeControlReference),
        matching(inboundControlReference, query),
      ),
    )
    .groupBy(documents.id, tradingPartners.id)

const interchangesOf = (db: Database, workspaceId: string, query: InterchangeListQuery) =>
  unionAll(
    outboundInterchanges(db, workspaceId, query),
    inboundInterchanges(db, workspaceId, query),
  )

type InterchangeRow = Awaited<ReturnType<typeof interchangesOf>>[number]

// The Runs of each Interchange in the order its Messages came, a Reprocess after the Run it replaced.
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
    runIdsOf(interchange).flatMap((runId) =>
      summaries
        .filter(({ id }) => id === runId)
        .map((summary) => ({
          ...summary,
          interchange: { id: interchange.id, controlReference: interchange.controlReference },
        })),
    )
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
        interchangesOf(db, workspace.id, query)
          .orderBy(desc(sql`prepared_at`), desc(sql`id`))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db
          .select({ count: count() })
          .from(interchangesOf(db, workspace.id, query).as('interchanges')),
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
  const [row] =
    direction === 'outbound'
      ? await db.select({ raw: runs.output }).from(runs).where(eq(runs.id, id))
      : await db.select({ raw: documents.content }).from(documents).where(eq(documents.id, id))

  if (row?.raw === null || row?.raw === undefined) {
    throw new Error(`Interchange ${id} has no raw text`)
  }

  return row.raw
}

const valueOf = (value: string | undefined, name: string, id: string) => {
  if (value === undefined || value === '') {
    throw new Error(`Interchange ${id} has no ${name}`)
  }

  return value
}

export const loadInterchange = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const row = yield* Effect.flatMap(
      Effect.promise(() =>
        db
          .select()
          .from(interchangesOf(db, workspace.id, { page: 1, pageSize: 1 }).as('interchanges'))
          .where(sql`id = ${id}`),
      ),
      ([found]) => foundOrNotFound(found),
    )

    const [raw, runsOf, messageIndexes, [own]] = yield* Effect.promise(() =>
      Promise.all([
        rawOf(db, row),
        listRunsOf(db, [row]),
        db
          .select({ id: runs.id, messageIndex: runs.messageIndex })
          .from(runs)
          .where(row.direction === 'outbound' ? eq(runs.id, id) : eq(runs.documentId, id)),
        db
          .select({ name: workspaces.name })
          .from(workspaces)
          .where(eq(workspaces.id, workspace.id)),
      ]),
    )

    const { header, messages } = parseMessages(raw)
    const tradingPartner = { name: row.tradingPartnerName }
    const ownCompany = { name: valueOf(own?.name, 'Workspace', id) }
    const sender = { gln: valueOf(header.elements[1]?.[0], 'sender', id) }
    const receiver = { gln: valueOf(header.elements[2]?.[0], 'receiver', id) }

    // An outbound Run's Interchange holds its one Message.
    const messageReferenceOf = (runId: string) => {
      const messageIndex = messageIndexes.find((run) => run.id === runId)?.messageIndex ?? 1

      return valueOf(
        messages[messageIndex - 1]?.header.elements[0]?.[0],
        `Message ${String(messageIndex)}`,
        id,
      )
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
