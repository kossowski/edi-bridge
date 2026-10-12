import type { MappingVersionEntry, RunListQuery } from '@edi-bridge/contracts'

export type VersionInUse = { version: number; partners: string[] }

export type VersionsInUse = { live: VersionInUse | undefined; stillInUse: VersionInUse[] }

export function liveVersions(entries: ReadonlyArray<MappingVersionEntry>): VersionsInUse {
  const [live, ...stillInUse] = [...entries]
    .sort((a, b) => b.version - a.version)
    .flatMap(({ version, flows }) =>
      flows.length === 0
        ? []
        : [
            {
              version,
              partners: [...new Set(flows.map(({ tradingPartner }) => tradingPartner.name))].sort(
                (a, b) => a.localeCompare(b, 'de'),
              ),
            },
          ],
    )

  return { live, stillInUse }
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
