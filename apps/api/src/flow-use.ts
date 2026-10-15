import { eq, inArray } from 'drizzle-orm'

import { flows, mappingVersions, tradingPartners } from '@edi-bridge/db'

import type { PinnedFlow, TradingPartnerSummary } from '@edi-bridge/contracts'

import { byName, inWorkspace } from './rows.js'

import type { Database, Transaction } from './db.js'

const groupedBy = <Row, Value>(
  rows: Row[],
  keyOf: (row: Row) => string,
  valueOf: (row: Row) => Value,
) => {
  const groups = Map.groupBy(rows, keyOf)

  return (key: string) => (groups.get(key) ?? []).map(valueOf)
}

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

  return groupedBy(
    rows.toSorted(byName),
    (row) => row.mappingId,
    ({ id, name }): TradingPartnerSummary => ({ id, name }),
  )
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

  const flowsOf = groupedBy(
    rows,
    (row) => row.mappingVersionId,
    (row): PinnedFlow => ({
      id: row.id,
      name: row.name,
      tradingPartner: { id: row.tradingPartnerId, name: row.tradingPartnerName },
    }),
  )

  return (mappingVersionId: string) => flowsOf(mappingVersionId).toSorted(byTradingPartnerAndName)
}
