import type { MappingVersionEntry, RunListQuery } from '@edi-bridge/contracts'

export type VersionInUse = { version: number; partners: string[] }

export type VersionsInUse = { live: VersionInUse | undefined; stillInUse: VersionInUse[] }

export type FlowInUse = { id: string; name: string; partner: string; version: number }

function versionsWithFlows(entries: ReadonlyArray<MappingVersionEntry>) {
  return [...entries].sort((a, b) => b.version - a.version).filter(({ flows }) => flows.length > 0)
}

export function liveVersions(entries: ReadonlyArray<MappingVersionEntry>): VersionsInUse {
  const [live, ...stillInUse] = versionsWithFlows(entries).map(({ version, flows }) => ({
    version,
    partners: [...new Set(flows.map(({ tradingPartner }) => tradingPartner.name))].sort((a, b) =>
      a.localeCompare(b, 'de'),
    ),
  }))

  return { live, stillInUse }
}

export function flowsInUse(entries: ReadonlyArray<MappingVersionEntry>): FlowInUse[] {
  return versionsWithFlows(entries)
    .flatMap(({ version, flows }) =>
      flows.map(({ id, name, tradingPartner }) => ({
        id,
        name,
        partner: tradingPartner.name,
        version,
      })),
    )
    .sort(
      (a, b) =>
        a.partner.localeCompare(b.partner, 'de') ||
        a.name.localeCompare(b.name, 'de') ||
        b.version - a.version,
    )
}

const failedWindowMs = 7 * 24 * 60 * 60 * 1000

export const failedDocumentsShown = 20

// Rounded down to the minute, so the query, and with it its cache entry, stays the same while the
// sheet is open.
export function failedDocumentsQuery(mappingId: string, now: Date): RunListQuery {
  const from = new Date(now.getTime() - failedWindowMs)

  from.setUTCSeconds(0, 0)

  return {
    mappingId: [mappingId],
    status: ['failed'],
    receivedFrom: from.toISOString(),
    page: 1,
    pageSize: failedDocumentsShown,
  }
}
