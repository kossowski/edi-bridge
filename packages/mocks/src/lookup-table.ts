import { delay, http, HttpResponse } from 'msw'

import {
  applyLookupTableImport,
  classifyLookupTableImport,
  codeMeaningsOf,
  createLookupTableEndpoint,
  defaultLanguage,
  deleteLookupTableEndpoint,
  directionOf,
  type FailedRunReference,
  fromSearchParams,
  type FixTarget,
  type GraphParts,
  importLookupTableEndpoint,
  type LookupTable,
  lookupTableEndpoint,
  lookupTableInUseMessage,
  lookupTableImportPreviewEndpoint,
  type Language,
  languageQuerySchema,
  type LookupTableImportRow,
  type LookupTableInput,
  lookupTableMissingCodesEndpoint,
  type LookupTableScope,
  type LookupTableScopeInput,
  lookupTablesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTableSuggestionsQuerySchema,
  type LookupTableSummary,
  type LookupTableUse,
  type MissingCode,
  type MissingCodeCounts,
  type RunSummary,
  type TradingPartner,
  type TradingPartnerSummary,
  updateLookupTableEndpoint,
  type Session,
  type WorkspaceSettings,
} from '@edi-bridge/contracts'

import { aiBudgetOf } from './ai-budget'
import { type ChannelRecord, type ChannelStore, seedChannels, toChannelStore } from './channel'
import { type FlowRecord, type FlowStore, seedFlows, toFlowStore } from './flow'
import { lookupTableFailureOf } from './interchange'
import { firstValuesOf, hintFor } from './lookup-table-codes'
import {
  type LookupTableRecord,
  type LookupTableStore,
  seedLookupTables,
  toLookupTableStore,
  workspaceScope,
} from './lookup-table-seed'
import {
  type MappingDraftRecord,
  type MappingDraftStore,
  publishedVersionsByMapping,
  seedMappingDrafts,
  toMappingDraftStore,
} from './mapping'
import {
  aiBudgetExhaustedProblem,
  badRequest,
  conflict,
  notFound,
  serverError,
  unprocessable,
} from './responses'
import { seedRuns } from './run'
import { problemOf } from './run-problem'
import { type Reprocessed, type RunStore, toRunStore } from './run-store'
import { seedSession, toSessionStore } from './session'
import { adminOnly, type SessionStore } from './session-access'
import {
  seedTradingPartners,
  toTradingPartnerStore,
  type TradingPartnerStore,
} from './trading-partner'
import { toWorkspaceSettingsStore, type WorkspaceSettingsStore } from './workspace-settings'

import type { MappingVersionStore } from './mapping-version'

export {
  type BlockingCode,
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

function scopeOf(
  scope: LookupTableScopeInput,
  tradingPartners: TradingPartnerNames,
): LookupTableScope {
  if (scope.kind === 'workspace') {
    return workspaceScope
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

function blockingCodesOf(missingCodes: ReadonlyArray<MissingCode>): string[] {
  return missingCodes.flatMap(({ code, urgency }) => (urgency === 'blocking' ? [code] : []))
}

function countsOf(missingCodes: ReadonlyArray<MissingCode>): MissingCodeCounts {
  const blocking = blockingCodesOf(missingCodes).length

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
    blockingCodes: blockingCodesOf(missingCodes),
  }
}

export function toLookupTable(
  record: LookupTableRecord,
  tradingPartners: TradingPartnerNames,
  usage: LookupTableUsage = unused,
  language: Language = defaultLanguage,
): LookupTable {
  return {
    ...toLookupTableSummary(record, tradingPartners, usage),
    entries: record.entries,
    codeMeanings: codeMeaningsOf(
      record.kind,
      record.entries.map(({ targetCode }) => targetCode),
      language,
    ),
  }
}

type LookupTableTarget = Extract<FixTarget, { kind: 'lookupTable' }>

export type LookupTableWorld = {
  mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
  versions?: MappingVersionStore | undefined
  flows?: ReadonlyArray<FlowRecord> | FlowStore
  channels?: ReadonlyArray<ChannelRecord> | ChannelStore
  runs?: ReadonlyArray<RunSummary> | RunStore
  reprocessed?: ReadonlyArray<Reprocessed>
}

function readsTable({ transforms }: GraphParts, tableId: string) {
  return transforms.some(
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

function newestFirst(a: Pick<RunSummary, 'receivedAt'>, b: Pick<RunSummary, 'receivedAt'>) {
  return Date.parse(b.receivedAt) - Date.parse(a.receivedAt)
}

let seedRunStore: RunStore | undefined

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
    runStore ??=
      world.runs === undefined && world.reprocessed === undefined
        ? (seedRunStore ??= toRunStore(seedRuns()))
        : toRunStore(world.runs ?? seedRuns(), world.reprocessed)

    return runStore
  }

  // Placing every Run is costly, and only a replacing Run takes another business reference.
  function placedOf(run: RunSummary) {
    return runs().replacedOf(run.id) === undefined ? run : runs().get(run.id)!
  }

  function targetOf(run: RunSummary): LookupTableTarget | null {
    const failure = lookupTableFailureOf(run)

    if (failure === null) {
      return null
    }

    if (!targets.has(run.id)) {
      const problem = problemOf(run, failure, null, {
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
        .flatMap(({ mappingVersionId, tradingPartnerId }) =>
          versions.find(mappingVersionId)?.version.mappingId === mappingId &&
          (scope.kind === 'workspace' || tradingPartnerId === scope.tradingPartnerId)
            ? [tradingPartnerId]
            : [],
        ),
    )

    return [...ids]
      .flatMap((id) => {
        const tradingPartner = tradingPartners.get(id)

        return tradingPartner ? [{ id: tradingPartner.id, name: tradingPartner.name }] : []
      })
      .sort(byName)
  }

  function usesOf(table: LookupTableRecord): LookupTableUse[] {
    const publishedReaders = new Set(
      (world.versions?.all() ?? []).flatMap((version) =>
        readsTable(version, table.id) ? [version.mappingId] : [],
      ),
    )

    return mappings
      .all()
      .flatMap((mapping) =>
        readsTable(mapping, table.id) || publishedReaders.has(mapping.id)
          ? [
              {
                mappingId: mapping.id,
                name: mapping.name,
                messageType: mapping.messageType,
                direction: directionOf(mapping),
                tradingPartners: partnersOf(mapping.id, table.scope),
              },
            ]
          : [],
      )
      .sort(byName)
  }

  function missingCodesOf(table: LookupTableRecord, language: Language): MissingCode[] {
    const translated = new Set(table.entries.map(({ sourceCode }) => sourceCode))
    const failedRuns = new Map<string, FailedRunReference[]>()

    function block(code: string, references: ReadonlyArray<FailedRunReference>) {
      if (!translated.has(code)) {
        failedRuns.set(code, [...(failedRuns.get(code) ?? []), ...references])
      }
    }

    for (const run of runs().unplaced()) {
      const target = targetOf(run)

      if (target?.lookupTableId === table.id && runs().replacingOf(run.id) === undefined) {
        block(target.code, [failedRunReference(placedOf(run))])
      }
    }

    for (const { code, failedRuns: references } of table.blockingCodes ?? []) {
      block(code, references)
    }

    const blocking = [...failedRuns]
      .map(([code, references]) => ({
        urgency: 'blocking' as const,
        code,
        ...hintFor(table.kind, code, language),
        failedRuns: references.toSorted(newestFirst),
      }))
      .toSorted((a, b) => newestFirst(a.failedRuns[0]!, b.failedRuns[0]!))

    const upcoming = (table.upcomingCodes ?? [])
      .toSorted((a, b) => b.itemCount - a.itemCount)
      .flatMap(({ code, itemCount }): MissingCode[] =>
        translated.has(code) || failedRuns.has(code)
          ? []
          : [{ urgency: 'upcoming', code, ...hintFor(table.kind, code, language), itemCount }],
      )

    return [...blocking, ...upcoming]
  }

  return (table: LookupTableRecord, language: Language): LookupTableUsage => ({
    uses: usesOf(table),
    missingCodes: missingCodesOf(table, language),
  })
}

type Usage = (table: LookupTableRecord, language: Language) => LookupTableUsage

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
        .map((table) =>
          toLookupTableSummary(table, tradingPartnerStore, usageOf(table, defaultLanguage)),
        )
        .sort(byName),
    ),
  )
}

export type LookupTablesState = 'loading' | 'error'

export type LookupTableSuggestionsState = 'aiBudgetExhausted'

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
    session = seedSession,
    settings,
    suggestions,
    ...world
  }: {
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore | LookupTablesState
    tradingPartners?: ReadonlyArray<TradingPartner> | TradingPartnerStore
    session?: Session | null | SessionStore
    settings?: WorkspaceSettings | WorkspaceSettingsStore
    suggestions?: LookupTableSuggestionsState | undefined
  } & LookupTableWorld = {},
) {
  if (lookupTables === 'loading' || lookupTables === 'error') {
    return stateHandlers(apiUrl, lookupTables)
  }

  const store = toLookupTableStore(lookupTables)
  const tradingPartnerStore = toTradingPartnerStore(tradingPartners)
  const usageOf = createLookupTableUsage(store, tradingPartnerStore, world)
  const sessionStore = toSessionStore(session)
  const settingsStore = toWorkspaceSettingsStore(settings)

  function languageOf(request: Request) {
    return languageQuerySchema.safeParse(fromSearchParams(new URL(request.url).searchParams))
  }

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
      ? { table, rows: classifyLookupTableImport(table.entries, body.data.csv) }
      : { response: badRequest(body.error.message) }
  }

  function serve(table: LookupTableRecord, language: Language, init?: ResponseInit) {
    return HttpResponse.json(
      toLookupTable(table, tradingPartnerStore, usageOf(table, language), language),
      init,
    )
  }

  return [
    lookupTableListHandler(apiUrl, store, tradingPartnerStore, usageOf),
    http.get(
      `${apiUrl}${lookupTableSuggestionsEndpoint.path}`,
      adminOnly(sessionStore, ({ request }, { workspace }) => {
        const query = lookupTableSuggestionsQuerySchema.safeParse(
          fromSearchParams(new URL(request.url).searchParams),
        )

        if (!query.success) {
          return badRequest(query.error.message)
        }

        const { kind, tradingPartnerId, language } = query.data

        if (tradingPartnerId !== undefined && !tradingPartnerStore.get(tradingPartnerId)) {
          return unprocessable('Unknown Trading Partner')
        }

        if (suggestions === 'aiBudgetExhausted') {
          return aiBudgetExhaustedProblem(
            aiBudgetOf(settingsStore, workspace.id, { exhausted: true }),
          )
        }

        return HttpResponse.json({ entries: firstValuesOf(kind, language) })
      }),
    ),
    http.get<{ id: string }>(`${apiUrl}${lookupTableEndpoint.path}`, ({ params, request }) => {
      const query = languageOf(request)

      if (!query.success) {
        return badRequest(query.error.message)
      }

      const table = store.get(params.id)

      return table ? serve(table, query.data.language) : notFound()
    }),
    http.get<{ id: string }>(
      `${apiUrl}${lookupTableMissingCodesEndpoint.path}`,
      ({ params, request }) => {
        const query = languageOf(request)

        if (!query.success) {
          return badRequest(query.error.message)
        }

        const table = store.get(params.id)

        return table
          ? HttpResponse.json(usageOf(table, query.data.language).missingCodes)
          : notFound()
      },
    ),
    http.post(
      `${apiUrl}${createLookupTableEndpoint.path}`,
      adminOnly(sessionStore, async ({ request }) => {
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

        return serve(created, defaultLanguage, { status: 201 })
      }),
    ),
    http.put<{ id: string }>(
      `${apiUrl}${updateLookupTableEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }) => {
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

        return serve(updated, defaultLanguage)
      }),
    ),
    http.delete<{ id: string }>(
      `${apiUrl}${deleteLookupTableEndpoint.path}`,
      adminOnly(sessionStore, ({ params }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        if (usageOf(existing, defaultLanguage).uses.length > 0) {
          return conflict(lookupTableInUseMessage)
        }

        store.delete(params.id)

        return new HttpResponse(null, { status: 204 })
      }),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${lookupTableImportPreviewEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }) => {
        const parsed = await parseImport(params.id, request)

        return 'response' in parsed ? parsed.response : HttpResponse.json({ rows: parsed.rows })
      }),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${importLookupTableEndpoint.path}`,
      adminOnly(sessionStore, async ({ params, request }) => {
        const parsed = await parseImport(params.id, request)

        if ('response' in parsed) {
          return parsed.response
        }

        const imported: LookupTableRecord = {
          ...parsed.table,
          entries: applyLookupTableImport(parsed.table.entries, parsed.rows),
          updatedAt: new Date().toISOString(),
        }

        store.set(imported)

        return serve(imported, defaultLanguage)
      }),
    ),
  ]
}
