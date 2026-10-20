import { eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  directionOf,
  type InterchangeReference,
  type MessageType,
  runSummarySchema,
} from '@edi-bridge/contracts'
import { type Connection, documents, flows, runs, tradingPartners } from '@edi-bridge/db'

// A Duplicate is never mapped, so it shows the Business Reference of its original Run.
const originalRuns = alias(runs, 'original_runs')

export const interchangeFields = {
  documentId: runs.documentId,
  interchangeControlReference: documents.interchangeControlReference,
  controlReference: runs.controlReference,
  built: sql<boolean>`${runs.output} is not null`,
}

type InterchangeRow = {
  messageType: MessageType
  documentId: string | null
  interchangeControlReference: string | null
  controlReference: number | null
  built: boolean
}

// A received Interchange is its Document; an outbound Run is its own once delivery built it.
export const interchangeOf = (id: string, row: InterchangeRow): InterchangeReference | null => {
  if (directionOf(row) === 'inbound') {
    return row.documentId === null || row.interchangeControlReference === null
      ? null
      : { id: row.documentId, controlReference: row.interchangeControlReference }
  }

  return row.built && row.controlReference !== null
    ? { id, controlReference: String(row.controlReference) }
    : null
}

export const runSummariesOf = async (db: Connection['db'], ids: readonly string[]) => {
  const rows = await db
    .select({
      workspaceId: runs.workspaceId,
      id: runs.id,
      receivedAt: runs.receivedAt,
      status: runs.status,
      failureStage: runs.failureStage,
      problem: runs.problem,
      manualSubmission: runs.manualSubmission,
      businessReference: sql<
        string | null
      >`coalesce(${runs.businessReference}, ${originalRuns.businessReference})`,
      tradingPartner: { id: tradingPartners.id, name: tradingPartners.name },
      flow: { id: flows.id, name: flows.name },
      messageType: flows.messageType,
      ...interchangeFields,
    })
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .leftJoin(originalRuns, eq(originalRuns.id, runs.duplicateOfRunId))
    .leftJoin(documents, eq(documents.id, runs.documentId))
    .where(inArray(runs.id, [...ids]))

  // The schema holds the database to a problem and Failure Stage exactly on a failed Run.
  return rows.map(({ workspaceId, problem, receivedAt, ...row }) => ({
    workspaceId,
    run: runSummarySchema.parse({
      ...row,
      receivedAt: receivedAt.toISOString(),
      direction: directionOf(row),
      problem: problem && { reason: problem.reason },
      interchange: interchangeOf(row.id, row),
    }),
  }))
}
