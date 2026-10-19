import { and, desc, eq, notExists, sql } from 'drizzle-orm'

import { flows, lookupTableEntries, runs, tradingPartners } from '@edi-bridge/db'

import type { BlockingMissingCode } from '@edi-bridge/contracts'

import type { Database, Transaction } from './db.js'

const lookupTableIdOfRun = sql<string>`${runs.problem} -> 'fixTarget' ->> 'lookupTableId'`

const codeOfRun = sql<string>`${runs.problem} -> 'fixTarget' ->> 'code'`

// A failed Run names a missing code until its Lookup Table translates that code.
export const selectBlockingCodes = async (
  db: Database | Transaction,
  workspaceId: string,
  lookupTableId?: string,
) => {
  const rows = await db
    .select({
      lookupTableId: lookupTableIdOfRun,
      code: codeOfRun,
      id: runs.id,
      receivedAt: runs.receivedAt,
      tradingPartnerId: tradingPartners.id,
      tradingPartnerName: tradingPartners.name,
      messageType: flows.messageType,
      businessReference: runs.businessReference,
    })
    .from(runs)
    .innerJoin(flows, eq(flows.id, runs.flowId))
    .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runs.status, 'failed'),
        sql`${runs.problem} -> 'fixTarget' ->> 'kind' = 'lookupTable'`,
        lookupTableId === undefined ? undefined : sql`${lookupTableIdOfRun} = ${lookupTableId}`,
        notExists(
          db
            .select({ sourceCode: lookupTableEntries.sourceCode })
            .from(lookupTableEntries)
            .where(
              and(
                sql`${lookupTableEntries.lookupTableId}::text = ${lookupTableIdOfRun}`,
                sql`${lookupTableEntries.sourceCode} = ${codeOfRun}`,
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(runs.receivedAt), desc(runs.id))

  const byLookupTable = Map.groupBy(rows, (row) => row.lookupTableId)

  return (id: string): BlockingMissingCode[] =>
    [...Map.groupBy(byLookupTable.get(id) ?? [], ({ code }) => code)].map(([code, failed]) => ({
      urgency: 'blocking',
      code,
      // Until code meanings are served (#228).
      meaning: null,
      suggestions: [],
      failedRuns: failed.map((run) => ({
        id: run.id,
        receivedAt: run.receivedAt.toISOString(),
        tradingPartner: { id: run.tradingPartnerId, name: run.tradingPartnerName },
        messageType: run.messageType,
        businessReference: run.businessReference,
      })),
    }))
}
