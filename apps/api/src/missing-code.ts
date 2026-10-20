import { and, desc, eq, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { flows, lookupTableEntries, runs, tradingPartners } from '@edi-bridge/db'

import type { BlockingMissingCode } from '@edi-bridge/contracts'

import type { Database, Transaction } from './db.js'

const lookupTableIdOfRun = sql<string>`${runs.problem} -> 'fixTarget' ->> 'lookupTableId'`

const codeOfRun = sql<string>`${runs.problem} -> 'fixTarget' ->> 'code'`

const replacing = alias(runs, 'replacing')

export type BlockingCodeRuns = Omit<BlockingMissingCode, 'meaning' | 'suggestions'>

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
        // A replaced Run is no longer open; the Run that replaces it counts instead.
        notExists(
          db
            .select({ id: replacing.id })
            .from(replacing)
            .where(eq(replacing.replacesRunId, runs.id)),
        ),
        // A failed Run stays failed once its code is translated, so the code is missing only until then.
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

  return (id: string): BlockingCodeRuns[] =>
    [...Map.groupBy(byLookupTable.get(id) ?? [], ({ code }) => code)].map(([code, failed]) => ({
      urgency: 'blocking',
      code,
      failedRuns: failed.map((run) => ({
        id: run.id,
        receivedAt: run.receivedAt.toISOString(),
        tradingPartner: { id: run.tradingPartnerId, name: run.tradingPartnerName },
        messageType: run.messageType,
        businessReference: run.businessReference,
      })),
    }))
}
