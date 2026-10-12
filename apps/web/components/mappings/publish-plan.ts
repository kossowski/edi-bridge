import { type MappingVersionEntry, maxChangeNoteLength } from '@edi-bridge/contracts'

export type RouteInUse = { id: string; name: string; partner: string; version: number }

export function routesInUse(entries: ReadonlyArray<MappingVersionEntry>): RouteInUse[] {
  return entries
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

export type ChangeNoteProblem = 'missing' | 'tooLong'

export function changeNoteProblem(note: string): ChangeNoteProblem | null {
  const trimmed = note.trim()

  if (trimmed === '') {
    return 'missing'
  }

  return trimmed.length > maxChangeNoteLength ? 'tooLong' : null
}

// Keeps the routes' order, so the request lists them as the dialog does.
export function chosenRouteIds(
  routes: ReadonlyArray<RouteInUse>,
  chosen: ReadonlySet<string>,
): string[] {
  return routes.flatMap(({ id }) => (chosen.has(id) ? [id] : []))
}
