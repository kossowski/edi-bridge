import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  createLookupTableEndpoint,
  deleteLookupTableEndpoint,
  importLookupTableEndpoint,
  type LookupTable,
  type LookupTableEntry,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  type LookupTableImportRow,
  type LookupTableInput,
  lookupTableSchema,
  type LookupTableScope,
  lookupTablesEndpoint,
  type LookupTableSummary,
  type TradingPartner,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'

import { applyImport, classifyImport } from './lookup-table-import'
import { badRequest, conflict, notFound, unprocessable } from './responses'
import { seedId } from './seed-id'
import { seedTradingPartners } from './trading-partner'

export type LookupTableRecord = Omit<LookupTable, 'entryCount'>

export function toLookupTable(record: LookupTableRecord): LookupTable {
  return { ...record, entryCount: record.entries.length }
}

export function toLookupTableSummary({ entries, ...table }: LookupTableRecord): LookupTableSummary {
  return { ...table, entryCount: entries.length }
}

function validated(record: LookupTableRecord): LookupTableRecord {
  lookupTableSchema.parse(toLookupTable(record))

  return record
}

const workspace: LookupTableScope = { kind: 'workspace' }

function partnerScope(tradingPartner: Pick<TradingPartner, 'id' | 'name'>): LookupTableScope {
  return {
    kind: 'tradingPartner',
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
  }
}

function entries(...pairs: ReadonlyArray<readonly [string, string]>): LookupTableEntry[] {
  return pairs.map(([sourceCode, targetCode]) => ({ sourceCode, targetCode }))
}

const [hansemarkt, alpenfrisch] = seedTradingPartners

const seeds: ReadonlyArray<Omit<LookupTableRecord, 'id'>> = [
  {
    name: 'Units of measure',
    scope: workspace,
    updatedAt: '2026-09-14T08:30:00.000Z',
    entries: entries(['ST', 'PCE'], ['STK', 'PCE'], ['KG', 'KGM'], ['L', 'LTR']),
  },
  {
    name: 'Country codes',
    scope: workspace,
    updatedAt: '2026-08-02T13:05:00.000Z',
    entries: entries(['Deutschland', 'DE'], ['Österreich', 'AT'], ['Schweiz', 'CH']),
  },
  {
    name: 'VAT categories',
    scope: workspace,
    updatedAt: '2026-07-21T09:45:00.000Z',
    entries: entries(['19', 'S'], ['7', 'AA'], ['0', 'Z']),
  },
  {
    name: 'Hansemarkt units',
    scope: partnerScope(hansemarkt!),
    updatedAt: '2026-09-30T15:12:00.000Z',
    entries: entries(['ST', 'PCE'], ['KAR', 'CT']),
  },
  {
    name: 'Alpenfrisch article groups',
    scope: partnerScope(alpenfrisch!),
    updatedAt: '2026-10-02T11:20:00.000Z',
    entries: entries(['OG', 'FRUIT'], ['MO', 'DAIRY'], ['BR', 'BAKERY']),
  },
]

export const seedLookupTables: ReadonlyArray<LookupTableRecord> = seeds.map((seed, index) =>
  validated({ id: seedId(8, index + 1), ...seed }),
)

export function seedLookupTableNamed(name: string): LookupTableRecord {
  const found = seedLookupTables.find((table) => table.name === name)

  if (!found) {
    throw new Error(`No seed Lookup Table named ${name}`)
  }

  return found
}

const subjects = ['units', 'country codes', 'article groups', 'VAT categories', 'packaging types']

function generateEntries(faker: Faker, count: number): LookupTableEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sourceCode: `${faker.string.alpha({ length: 2, casing: 'upper' })}${index + 1}`,
    targetCode: faker.string.alphanumeric({ length: { min: 2, max: 3 }, casing: 'upper' }),
  }))
}

export function createLookupTables({
  count,
  entryCount,
  now = new Date(),
  seed = 31,
  tradingPartners = seedTradingPartners,
}: {
  count: number
  entryCount?: number
  now?: Date
  seed?: number
  tradingPartners?: ReadonlyArray<Pick<TradingPartner, 'id' | 'name'>>
}): LookupTableRecord[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, (_, index) => {
    const tradingPartner = index % 3 === 0 ? null : faker.helpers.arrayElement(tradingPartners)
    const subject = faker.helpers.arrayElement(subjects)

    return validated({
      id: faker.string.uuid(),
      name: tradingPartner
        ? `${tradingPartner.name.split(/[\s,]/)[0]} ${subject} ${index + 1}`
        : `${subject[0]!.toUpperCase()}${subject.slice(1)} ${index + 1}`,
      scope: tradingPartner ? partnerScope(tradingPartner) : workspace,
      updatedAt: faker.date.past({ years: 1, refDate: now }).toISOString(),
      entries: generateEntries(faker, entryCount ?? faker.number.int({ min: 0, max: 12 })),
    })
  })
}

export type LookupTableStore = {
  all: () => readonly LookupTableRecord[]
  get: (id: string) => LookupTableRecord | undefined
  set: (table: LookupTableRecord) => void
  delete: (id: string) => void
}

export function createLookupTableStore(
  lookupTables: ReadonlyArray<LookupTableRecord> = seedLookupTables,
): LookupTableStore {
  const byId = new Map(lookupTables.map((table) => [table.id, table]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (table) => {
      byId.set(table.id, table)
    },
    delete: (id) => {
      byId.delete(id)
    },
  }
}

export function toLookupTableStore(
  lookupTables: ReadonlyArray<LookupTableRecord> | LookupTableStore = seedLookupTables,
) {
  return 'get' in lookupTables ? lookupTables : createLookupTableStore(lookupTables)
}

export function lookupTablesHandler(
  apiUrl: string,
  lookupTables: ReadonlyArray<LookupTableRecord> | LookupTableStore = seedLookupTables,
) {
  const store = toLookupTableStore(lookupTables)

  return http.get(`${apiUrl}${lookupTablesEndpoint.path}`, () =>
    HttpResponse.json(
      store
        .all()
        .map(toLookupTableSummary)
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    ),
  )
}

function sameName(a: string, b: string) {
  return a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0
}

function sameScope(a: LookupTableScope, b: LookupTableScope) {
  return a.kind === 'workspace'
    ? b.kind === 'workspace'
    : b.kind === 'tradingPartner' && a.tradingPartner.id === b.tradingPartner.id
}

export function lookupTableHandlers(
  apiUrl: string,
  {
    lookupTables = seedLookupTables,
    tradingPartners = seedTradingPartners,
  }: {
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore
    tradingPartners?: ReadonlyArray<Pick<TradingPartner, 'id' | 'name'>>
  } = {},
) {
  const store = toLookupTableStore(lookupTables)

  async function parseInput(
    request: Request,
    ownId?: string,
  ): Promise<
    { table: Pick<LookupTableRecord, 'name' | 'scope' | 'entries'> } | { response: Response }
  > {
    const body = createLookupTableEndpoint.body.safeParse(await request.json())

    if (!body.success) {
      return { response: badRequest(body.error.message) }
    }

    const { name, entries, scope: scopeInput }: LookupTableInput = body.data
    let scope: LookupTableScope = workspace

    if (scopeInput.kind === 'tradingPartner') {
      const tradingPartner = tradingPartners.find(({ id }) => id === scopeInput.tradingPartnerId)

      if (!tradingPartner) {
        return { response: unprocessable('Unknown Trading Partner') }
      }

      scope = partnerScope(tradingPartner)
    }

    const taken = store
      .all()
      .some(
        (other) =>
          other.id !== ownId && sameName(other.name, name) && sameScope(other.scope, scope),
      )

    if (taken) {
      return { response: conflict('Another Lookup Table of this scope already uses this name') }
    }

    return { table: { name, scope, entries } }
  }

  async function parseImport(
    id: string,
    request: Request,
  ): Promise<{ table: LookupTableRecord; rows: LookupTableImportRow[] } | { response: Response }> {
    const table = store.get(id)

    if (!table) {
      return { response: notFound() }
    }

    const body = lookupTableImportPreviewEndpoint.body.safeParse(await request.json())

    return body.success
      ? { table, rows: classifyImport(table.entries, body.data.csv) }
      : { response: badRequest(body.error.message) }
  }

  return [
    lookupTablesHandler(apiUrl, store),
    http.get<{ id: string }>(`${apiUrl}${lookupTableEndpoint.path}`, ({ params }) => {
      const table = store.get(params.id)

      return table ? HttpResponse.json(toLookupTable(table)) : notFound()
    }),
    http.post(`${apiUrl}${createLookupTableEndpoint.path}`, async ({ request }) => {
      const parsed = await parseInput(request)

      if ('response' in parsed) {
        return parsed.response
      }

      const created: LookupTableRecord = {
        ...parsed.table,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      }

      store.set(created)

      return HttpResponse.json(toLookupTable(created), { status: 201 })
    }),
    http.put<{ id: string }>(
      `${apiUrl}${updateLookupTableEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        const parsed = await parseInput(request, existing.id)

        if ('response' in parsed) {
          return parsed.response
        }

        const updated: LookupTableRecord = {
          ...existing,
          ...parsed.table,
          updatedAt: new Date().toISOString(),
        }

        store.set(updated)

        return HttpResponse.json(toLookupTable(updated))
      },
    ),
    http.delete<{ id: string }>(`${apiUrl}${deleteLookupTableEndpoint.path}`, ({ params }) => {
      if (!store.get(params.id)) {
        return notFound()
      }

      store.delete(params.id)

      return new HttpResponse(null, { status: 204 })
    }),
    http.post<{ id: string }>(
      `${apiUrl}${lookupTableImportPreviewEndpoint.path}`,
      async ({ params, request }) => {
        const parsed = await parseImport(params.id, request)

        return 'response' in parsed ? parsed.response : HttpResponse.json({ rows: parsed.rows })
      },
    ),
    http.post<{ id: string }>(
      `${apiUrl}${importLookupTableEndpoint.path}`,
      async ({ params, request }) => {
        const parsed = await parseImport(params.id, request)

        if ('response' in parsed) {
          return parsed.response
        }

        const imported: LookupTableRecord = {
          ...parsed.table,
          entries: applyImport(parsed.table.entries, parsed.rows),
          updatedAt: new Date().toISOString(),
        }

        store.set(imported)

        return HttpResponse.json(toLookupTable(imported))
      },
    ),
  ]
}
