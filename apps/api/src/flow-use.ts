import { eq, inArray } from 'drizzle-orm'

import { flows, mappingVersions, tradingPartners } from '@edi-bridge/db'

import type { PinnedFlow, TradingPartnerSummary } from '@edi-bridge/contracts'

import { byName, inWorkspace } from './rows.js'

import type { Database, Transaction } from './db.js'

export const selectTradingPartnersByMapping = async (
  db: Database | Transaction,
  workspaceId: string,
) => {
  const rows = await db
    .selectDistinct({
      mappingId: mappingVersions.mappingId,
      id: tradingPartners.id,
      name: tradingPartners.name,
    })
    .from(flows)
    .innerJoin(mappingVersions, eq(flows.mappingVersionId, mappingVersions.id))
    .innerJoin(tradingPartners, eq(flows.tradingPartnerId, tradingPartners.id))
    .where(inWorkspace(flows, workspaceId))

  const byMapping = new Map<string, TradingPartnerSummary[]>()

  for (const { mappingId, id, name } of rows.toSorted(byName)) {
    byMapping.set(mappingId, [...(byMapping.get(mappingId) ?? []), { id, name }])
  }

  return (mappingId: string) => byMapping.get(mappingId) ?? []
}

const byTradingPartnerAndName = (a: PinnedFlow, b: PinnedFlow) =>
  byName(a.tradingPartner, b.tradingPartner) || byName(a, b)

export const selectPinnedFlows = async (db: Database, mappingVersionIds: string[]) => {
  const rows =
    mappingVersionIds.length === 0
      ? []
      : await db
          .select({
            id: flows.id,
            name: flows.name,
            mappingVersionId: flows.mappingVersionId,
            tradingPartnerId: tradingPartners.id,
            tradingPartnerName: tradingPartners.name,
          })
          .from(flows)
          .innerJoin(tradingPartners, eq(flows.tradingPartnerId, tradingPartners.id))
          .where(inArray(flows.mappingVersionId, mappingVersionIds))

  const byVersion = new Map<string, PinnedFlow[]>()

  for (const row of rows) {
    byVersion.set(row.mappingVersionId, [
      ...(byVersion.get(row.mappingVersionId) ?? []),
      {
        id: row.id,
        name: row.name,
        tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
      },
    ])
  }

  return (mappingVersionId: string) =>
    (byVersion.get(mappingVersionId) ?? []).toSorted(byTradingPartnerAndName)
}
