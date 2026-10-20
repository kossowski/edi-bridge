import { and, eq, sql } from 'drizzle-orm'

import { runs, tradingPartners } from './schema.js'

import type { Connection, Transaction } from './client.js'

export async function claimTradingPartnerControlReference(
  tx: Transaction,
  tradingPartnerId: string,
) {
  const [partner] = await tx
    .update(tradingPartners)
    .set({ nextControlReference: sql`${tradingPartners.nextControlReference} + 1` })
    .where(eq(tradingPartners.id, tradingPartnerId))
    .returning({ claimed: sql<number>`${tradingPartners.nextControlReference} - 1` })

  if (partner === undefined) {
    throw new Error(`Trading Partner ${tradingPartnerId} is missing`)
  }

  return partner.claimed
}

// A Run keeps its reference, so a Retry resends the same Interchange.
export function claimControlReference(
  db: Connection['db'],
  { workspaceId, runId }: { workspaceId: string; runId: string },
) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ tradingPartnerId: runs.tradingPartnerId, controlReference: runs.controlReference })
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
      .for('update')

    if (run === undefined) {
      throw new Error(`Run ${runId} is missing`)
    }

    if (run.controlReference !== null) {
      return run.controlReference
    }

    const claimed = await claimTradingPartnerControlReference(tx, run.tradingPartnerId)

    await tx.update(runs).set({ controlReference: claimed }).where(eq(runs.id, runId))

    return claimed
  })
}
