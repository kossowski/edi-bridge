import { delay, http, HttpResponse } from 'msw'

import {
  createLookupTableEndpoint,
  deleteLookupTableEndpoint,
  directionOf,
  type FailedRunReference,
  fromSearchParams,
  type FixTarget,
  importLookupTableEndpoint,
  type LookupTable,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  type LookupTableImportRow,
  type LookupTableInput,
  lookupTableMissingCodesEndpoint,
  type LookupTableScope,
  type LookupTableScopeInput,
  lookupTablesEndpoint,
  lookupTableSuggestionsEndpoint,
  type LookupTableSummary,
  type LookupTableUse,
  type MissingCode,
  type MissingCodeCounts,
  type RunSummary,
  type TradingPartner,
  type TradingPartnerSummary,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'

import { type ChannelRecord, type ChannelStore, seedChannels, toChannelStore } from './channel'
import { type FlowRecord, type FlowStore, seedFlows, toFlowStore } from './flow'
import { generateMessage } from './interchange'
import { codeMeaningsOf, firstValuesOf, hintFor } from './lookup-table-codes'
import { applyImport, classifyImport } from './lookup-table-import'
import {
  type LookupTableRecord,
  type LookupTableStore,
  seedLookupTables,
  toLookupTableStore,
} from './lookup-table-seed'
import {
  type MappingDraftRecord,
  type MappingDraftStore,
  publishedVersionsByMapping,
  seedMappingDrafts,
  toMappingDraftStore,
} from './mapping'
import { badRequest, conflict, notFound, serverError, unprocessable } from './responses'
import { seedRuns } from './run'
import { problemOf } from './run-problem'
import { type Reprocessed, type RunStore, toRunStore } from './run-store'
import {
  seedTradingPartners,
  toTradingPartnerStore,
  type TradingPartnerStore,
} from './trading-partner'

export {
  createLookupTables,
  createLookupTableStore,
  type LookupTableRecord,
  type LookupTableStore,
  partnerScope,
  seedLookupTableNamed,
  seedLookupTables,
  toLookupTableStore,
  type UpcomingCode,
} from './lookup-table-seed'

type TradingPartnerNames = {
  get: (id: string) => Pick<TradingPartner, 'id' | 'name'> | undefined
}

const workspace = { kind: 'workspace' } as const

function scopeOf(
  scope: LookupTableScopeInput,
  tradingPartners: TradingPartnerNames,
): LookupTableScope {
  if (scope.kind === 'workspace') {
    return workspace
  }

  const tradingPartner = tradingPartners.get(scope.tradingPartnerId)

  if (!tradingPartner) {
    throw new Error(`No Trading Partner with id ${scope.tradingPartnerId}`)
  }

  return {
    kind: 'tradingPartner',
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
  }
}

export type LookupTableUsage = {
  uses: LookupTableUse[]
  missingCodes: MissingCode[]
}

const unused: LookupTableUsage = { uses: [], missingCodes: [] }

function countsOf(missingCodes: ReadonlyArray<MissingCode>): MissingCodeCounts {
  const blocking = missingCodes.filter(({ urgency }) => urgency === 'blocking').length

  return { blocking, upcoming: missingCodes.length - blocking }
}

export function toLookupTableSummary(
  { id, name, kind, entries, scope, updatedAt }: LookupTableRecord,
  tradingPartners: TradingPartnerNames,
  { uses, missingCodes }: LookupTableUsage = unused,
): LookupTableSummary {
  return {
    id,
    name,
    kind,
    updatedAt,
    scope: scopeOf(scope, tradingPartners),
    entryCount: entries.length,
    uses,
    missingCodeCounts: countsOf(missingCodes),
  }
}

export function toLookupTable(
  record: LookupTableRecord,
  tradingPartners: TradingPartnerNames,
  usage: LookupTableUsage = unused,
): LookupTable {
  return {
    ...toLookupTableSummary(record, tradingPartners, usage),
    entries: record.entries,
    codeMeanings: codeMeaningsOf(
      record.kind,
      record.entries.map(({ targetCode }) => targetCode),
    ),
  }
}

type LookupTableTarget = Extract<FixTarget, { kind: 'lookupTable' }>

export type LookupTableWorld = {
  mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
  flows?: ReadonlyArray<FlowRecord> | FlowStore
  channels?: ReadonlyArray<ChannelRecord> | ChannelStore
  runs?: ReadonlyArray<RunSummary> | RunStore
  reprocessed?: ReadonlyArray<Reprocessed>
}

function readsTable(mapping: MappingDraftRecord, tableId: string) {
  return mapping.transforms.some(
    (transform) => transform.kind === 'lookupTable' && transform.config.lookupTableId === tableId,
  )
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, 'de')
}

function failedRunReference(run: RunSummary): FailedRunReference {
  return {
    id: run.id,
    receivedAt: run.receivedAt,
    tradingPartner: run.tradingPartner,
    messageType: run.messageType,
    businessReference: run.businessReference,
  }
}

function newestFirst(a: RunSummary, b: RunSummary) {
  return Date.parse(b.receivedAt) - Date.parse(a.receivedAt)
}

export function createLookupTableUsage(
  lookupTables: LookupTableStore,
  tradingPartners: TradingPartnerStore,
  world: LookupTableWorld = {},
) {
  const mappings = toMappingDraftStore(world.mappings ?? seedMappingDrafts)
  const flows = toFlowStore(world.flows ?? seedFlows)
  const channels = toChannelStore(world.channels ?? seedChannels)
  let runStore: RunStore | undefined
  const targets = new Map<string, LookupTableTarget | null>()

  function runs() {
    runStore ??= toRunStore(world.runs ?? seedRuns(), world.reprocessed)

    return runStore
  }

  function targetOf(run: RunSummary): LookupTableTarget | null {
    if (run.status !== 'failed' || run.failureStage !== 'mapping') {
      return null
    }

    if (!targets.has(run.id)) {
      const problem = problemOf(run, generateMessage(run, '1'), null, {
        flows,
        channels,
        lookupTables,
      })

      const target = problem?.fixTarget
      targets.set(run.id, target?.kind === 'lookupTable' ? target : null)
    }

    return targets.get(run.id) ?? null
  }

  function partnersOf(mappingId: string, scope: LookupTableScopeInput): TradingPartnerSummary[] {
    const versions = publishedVersionsByMapping(mappings.all())

    const ids = new Set(
      flows
        .all()
        .filter(
          ({ mappingVersionId }) =>
            versions.find(mappingVersionId)?.version.mappingId === mappingId,
        )
        .map(({ tradingPartnerId }) => tradingPartnerId)
        .filter((id) => scope.kind === 'workspace' || id === scope.tradingPartnerId),
    )

    return [...ids]
      .flatMap((id) => {
        const tradingPartner = tradingPartners.get(id)

        return tradingPartner ? [{ id: tradingPartner.id, name: tradingPartner.name }] : []
      })
      .sort(byName)
  }

  function usesOf(table: LookupTableRecord): LookupTableUse[] {
    return mappings
      .all()
      .filter((mapping) => readsTable(mapping, table.id))
      .map((mapping) => ({
        mappingId: mapping.id,
        name: mapping.name,
        messageType: mapping.messageType,
        direction: directionOf(mapping),
        tradingPartners: partnersOf(mapping.id, table.scope),
      }))
      .sort(byName)
  }

  function missingCodesOf(table: LookupTableRecord): MissingCode[] {
    const translated = new Set(table.entries.map(({ sourceCode }) => sourceCode))
    const failedRuns = new Map<string, RunSummary[]>()

    for (const run of runs().all()) {
      const target = targetOf(run)

      if (
        target?.lookupTableId === table.id &&
        !translated.has(target.code) &&
        runs().replacingOf(run.id) === undefined
      ) {
        failedRuns.set(target.code, [...(failedRuns.get(target.code) ?? []), run])
      }
    }

    const blocking = [...failedRuns].map(([code, codeRuns]): MissingCode => ({
      urgency: 'blocking',
      code,
      ...hintFor(table.kind, code),
      failedRuns: codeRuns.sort(newestFirst).map(failedRunReference),
    }))

    const upcoming = (table.upcomingCodes ?? [])
      .filter(({ code }) => !translated.has(code) && !failedRuns.has(code))
      .toSorted((a, b) => b.itemCount - a.itemCount)
      .map(({ code, itemCount }): MissingCode => ({
        urgency: 'upcoming',
        code,
        ...hintFor(table.kind, code),
        itemCount,
      }))

    return [...blocking, ...upcoming]
  }

  return (table: LookupTableRecord): LookupTableUsage => ({
    uses: usesOf(table),
    missingCodes: missingCodesOf(table),
  })
}

type Usage = (table: LookupTableRecord) => LookupTableUsage

export function lookupTableListHandler(
  apiUrl: string,
  lookupTables: ReadonlyArray<LookupTableRecord> | LookupTableStore = seedLookupTables,
  tradingPartners: ReadonlyArray<TradingPartner> | TradingPartnerStore = seedTradingPartners,
  usage?: Usage,
) {
  const store = toLookupTableStore(lookupTables)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)
  const usageOf = usage ?? createLookupTableUsage(store, tradingPartnerStore)

  return http.get(`${apiUrl}${lookupTablesEndpoint.path}`, () =>
    HttpResponse.json(
      store
        .all()
        .map((table) => toLookupTableSummary(table, tradingPartnerStore, usageOf(table)))
        .sort(byName),
    ),
  )
}

export type LookupTablesState = 'loading' | 'error'

function stateHandlers(apiUrl: string, state: LookupTablesState) {
  const respond = async () => {
    if (state === 'loading') {
      await delay('infinite')
    }

    return serverError()
  }

  return [
    http.get(`${apiUrl}${lookupTablesEndpoint.path}`, respond),
    http.get(`${apiUrl}${lookupTableSuggestionsEndpoint.path}`, respond),
    http.get(`${apiUrl}${lookupTableMissingCodesEndpoint.path}`, respond),
    http.get(`${apiUrl}${lookupTableEndpoint.path}`, respond),
  ]
}

function sameName(a: string, b: string) {
  return a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0
}

function sameScope(a: LookupTableScopeInput, b: LookupTableScopeInput) {
  return a.kind === 'workspace'
    ? b.kind === 'workspace'
    : b.kind === 'tradingPartner' && a.tradingPartnerId === b.tradingPartnerId
}

export function lookupTableHandlers(
  apiUrl: string,
  {
    lookupTables = seedLookupTables,
    tradingPartners = seedTradingPartners,
    ...world
  }: {
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore | LookupTablesState
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
  } & LookupTableWorld = {},
) {
  if (lookupTables === 'loading' || lookupTables === 'error') {
    return stateHandlers(apiUrl, lookupTables)
  }

  const store = toLookupTableStore(lookupTables)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)
  const usageOf = createLookupTableUsage(store, tradingPartnerStore, world)

  function nameTaken(name: string, scope: LookupTableScopeInput, ownId?: string) {
    return store
      .all()
      .some(
        (other) =>
          other.id !== ownId && sameName(other.name, name) && sameScope(other.scope, scope),
      )
  }

  async function parseInput(
    request: Request,
    ownId?: string,
  ): Promise<
    | { table: Pick<LookupTableRecord, 'name' | 'kind' | 'scope' | 'entries'> }
    | { response: Response }
  > {
    const body = createLookupTableEndpoint.body.safeParse(await request.json())

    if (!body.success) {
      return { response: badRequest(body.error.message) }
    }

    const { name, kind, entries, scope }: LookupTableInput = body.data

    if (scope.kind === 'tradingPartner' && !tradingPartnerStore.get(scope.tradingPartnerId)) {
      return { response: unprocessable('Unknown Trading Partner') }
    }

    if (nameTaken(name, scope, ownId)) {
      return { response: conflict('Another Lookup Table of this scope already uses this name') }
    }

    return { table: { name, kind, scope, entries } }
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

  function serve(table: LookupTableRecord, init?: ResponseInit) {
    return HttpResponse.json(toLookupTable(table, tradingPartnerStore, usageOf(table)), init)
  }

  return [
    lookupTableListHandler(apiUrl, store, tradingPartnerStore, usageOf),
    http.get(`${apiUrl}${lookupTableSuggestionsEndpoint.path}`, ({ request }) => {
      const query = lookupTableSuggestionsEndpoint.query.safeParse(
        fromSearchParams(new URL(request.url).searchParams),
      )

      if (!query.success) {
        return badRequest(query.error.message)
      }

      const { kind, tradingPartnerId } = query.data

      if (tradingPartnerId !== undefined && !tradingPartnerStore.get(tradingPartnerId)) {
        return unprocessable('Unknown Trading Partner')
      }

      return HttpResponse.json({ entries: firstValuesOf(kind) })
    }),
    http.get<{ id: string }>(`${apiUrl}${lookupTableEndpoint.path}`, ({ params }) => {
      const table = store.get(params.id)

      return table ? serve(table) : notFound()
    }),
    http.get<{ id: string }>(`${apiUrl}${lookupTableMissingCodesEndpoint.path}`, ({ params }) => {
      const table = store.get(params.id)

      return table ? HttpResponse.json(usageOf(table).missingCodes) : notFound()
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

      return serve(created, { status: 201 })
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

        return serve(updated)
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

        return serve(imported)
      },
    ),
  ]
}
