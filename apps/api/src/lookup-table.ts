import { asc, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  applyLookupTableImport,
  type BlockingMissingCode,
  classifyLookupTableImport,
  codeMeaningOf,
  codeMeaningsOf,
  defaultLanguage,
  type Language,
  type LookupTable,
  type LookupTableEntry,
  type LookupTableImportBody,
  type LookupTableImportPreview,
  type LookupTableInput,
  type LookupTableScope,
  type LookupTableKind,
  type LookupTableScopeInput,
  type LookupTableSuggestions,
  type LookupTableSuggestionsQuery,
  lookupTableInUseMessage,
  type LookupTableSummary,
  type LookupTableUse,
} from '@edi-bridge/contracts'
import {
  lookupTableEntries,
  lookupTables,
  lookupTableTradingPartnerNameUnique,
  lookupTableWorkspaceNameUnique,
  tradingPartners,
} from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { Conflict, NotFound } from './errors.js'
import { lookupTableUnused, selectLookupTableUses, selectUsesOfLookupTable } from './mapping-use.js'
import { type BlockingCodeRuns, selectBlockingCodes } from './missing-code.js'
import {
  byName,
  foundOrNotFound,
  inWorkspace,
  failingOnDuplicate,
  rejectingInvalidId,
  writingInWorkspace,
} from './rows.js'
import { assertTradingPartnerIn, rejectingUnknownTradingPartner } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const selectRows = (db: Database | Transaction, where: SQL | undefined) =>
  db
    .select({
      ...getTableColumns(lookupTables),
      tradingPartnerName: tradingPartners.name,
      entryCount: db.$count(
        lookupTableEntries,
        eq(lookupTableEntries.lookupTableId, lookupTables.id),
      ),
    })
    .from(lookupTables)
    .leftJoin(tradingPartners, eq(lookupTables.tradingPartnerId, tradingPartners.id))
    .where(where)

type Row = Awaited<ReturnType<typeof selectRows>>[number]

const scopeOf = ({ tradingPartnerId, tradingPartnerName }: Row): LookupTableScope =>
  tradingPartnerId !== null && tradingPartnerName !== null
    ? { kind: 'tradingPartner', tradingPartner: { id: tradingPartnerId, name: tradingPartnerName } }
    : { kind: 'workspace' }

const toSummary = (
  row: Row,
  uses: LookupTableUse[],
  blocking: BlockingCodeRuns[],
): LookupTableSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  scope: scopeOf(row),
  entryCount: row.entryCount,
  uses,
  missingCodeCounts: { blocking: blocking.length, upcoming: 0 },
  blockingCodes: blocking.map(({ code }) => code),
  updatedAt: row.updatedAt.toISOString(),
})

const entryColumns = {
  sourceCode: lookupTableEntries.sourceCode,
  targetCode: lookupTableEntries.targetCode,
}

const selectEntries = (db: Database | Transaction, lookupTableId: string) =>
  db
    .select(entryColumns)
    .from(lookupTableEntries)
    .where(eq(lookupTableEntries.lookupTableId, lookupTableId))
    .orderBy(asc(lookupTableEntries.position))

export const loadLookupTableEntries = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return new Map<string, LookupTableEntry[]>()
    }

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select({ lookupTableId: lookupTables.id, entry: entryColumns })
        .from(lookupTables)
        .leftJoin(lookupTableEntries, eq(lookupTableEntries.lookupTableId, lookupTables.id))
        .where(inWorkspace(lookupTables, workspace.id, inArray(lookupTables.id, [...ids])))
        .orderBy(asc(lookupTableEntries.position)),
    )

    return new Map(
      [...Map.groupBy(rows, ({ lookupTableId }) => lookupTableId)].map(([id, entries]) => [
        id,
        entries.flatMap(({ entry }) => (entry ? [entry] : [])),
      ]),
    )
  })

export const listLookupTables = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const [rows, usesOf, blockingOf] = yield* Effect.promise(() =>
    Promise.all([
      selectRows(db, inWorkspace(lookupTables, workspace.id)),
      selectLookupTableUses(db, workspace.id),
      selectBlockingCodes(db, workspace.id),
    ]),
  )

  return rows.map((row) => toSummary(row, usesOf(row.id), blockingOf(row.id))).toSorted(byName)
})

const selectLookupTable = async (
  db: Database | Transaction,
  workspaceId: string,
  id: string,
  language: Language = defaultLanguage,
): Promise<LookupTable | undefined> => {
  const [row] = await selectRows(
    db,
    inWorkspace(lookupTables, workspaceId, eq(lookupTables.id, id)),
  )

  if (!row) {
    return undefined
  }

  const [uses, blockingOf] = await Promise.all([
    selectUsesOfLookupTable(db, workspaceId, row.id),
    selectBlockingCodes(db, workspaceId, row.id),
  ])

  const entries = await selectEntries(db, row.id)

  return {
    ...toSummary(row, uses, blockingOf(row.id)),
    entries,
    codeMeanings: codeMeaningsOf(
      row.kind,
      entries.map(({ targetCode }) => targetCode),
      language,
    ),
  }
}

export const loadLookupTable = (id: string, language: Language = defaultLanguage) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    return yield* foundOrNotFound(
      yield* Effect.promise(() => selectLookupTable(db, workspace.id, id, language)),
    )
  })

const rejectingUnknownLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [found] = yield* Effect.promise(() =>
      db
        .select({ kind: lookupTables.kind })
        .from(lookupTables)
        .where(inWorkspace(lookupTables, workspace.id, eq(lookupTables.id, id))),
    )

    if (!found) {
      return yield* new NotFound()
    }

    return found.kind
  })

// A partner code that is itself a known code likely means that code.
const withMeaning =
  (kind: LookupTableKind, language: Language) =>
  (missing: BlockingCodeRuns): BlockingMissingCode => {
    const meaning = codeMeaningOf(kind, missing.code, language)

    return {
      ...missing,
      meaning,
      suggestions: meaning === null ? [] : [{ code: missing.code, meaning }],
    }
  }

export const listLookupTableMissingCodes = (id: string, language: Language) =>
  Effect.gen(function* () {
    const kind = yield* rejectingUnknownLookupTable(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace
    const blockingOf = yield* Effect.promise(() => selectBlockingCodes(db, workspace.id, id))

    return blockingOf(id).map(withMeaning(kind, language))
  })

export const suggestLookupTableEntries = ({ tradingPartnerId }: LookupTableSuggestionsQuery) =>
  Effect.gen(function* () {
    if (tradingPartnerId !== undefined) {
      yield* rejectingUnknownTradingPartner(tradingPartnerId)
    }

    // Until suggested code values exist (#228).
    return { entries: [] } satisfies LookupTableSuggestions
  })

const tradingPartnerIdOf = (scope: LookupTableScopeInput) =>
  scope.kind === 'tradingPartner' ? scope.tradingPartnerId : null

// Postgres takes at most 65,535 parameters per statement, four per entry.
const entryInsertChunkSize = 10_000

const insertEntries = async (
  tx: Transaction,
  lookupTableId: string,
  entries: LookupTableEntry[],
) => {
  const rows = entries.map((entry, position) => ({ ...entry, lookupTableId, position }))

  for (let start = 0; start < rows.length; start += entryInsertChunkSize) {
    await tx.insert(lookupTableEntries).values(rows.slice(start, start + entryInsertChunkSize))
  }
}

const rewriteLookupTable = async (
  tx: Transaction,
  workspaceId: string,
  id: string,
  set: Partial<typeof lookupTables.$inferInsert>,
  entriesOf: () => Promise<LookupTableEntry[]>,
) => {
  const locked = await tx
    .update(lookupTables)
    .set({ ...set, updatedAt: sql`now()` })
    .where(inWorkspace(lookupTables, workspaceId, eq(lookupTables.id, id)))
    .returning({ id: lookupTables.id })

  // A DELETE between loadLookupTable and the rewrite leaves no row to write.
  if (locked.length === 0) {
    return undefined
  }

  const entries = await entriesOf()

  await tx.delete(lookupTableEntries).where(eq(lookupTableEntries.lookupTableId, id))
  await insertEntries(tx, id, entries)

  return selectLookupTable(tx, workspaceId, id)
}

const nameUniqueConstraints = [lookupTableWorkspaceNameUnique, lookupTableTradingPartnerNameUnique]

const writeInTransaction = <A>(write: (tx: Transaction) => Promise<A>) =>
  writingInWorkspace(write).pipe(
    failingOnDuplicate(
      nameUniqueConstraints,
      'Another Lookup Table of this scope already uses this name',
    ),
  )

export const createLookupTable = ({ name, kind, scope, entries }: LookupTableInput) =>
  Effect.gen(function* () {
    const workspace = yield* CurrentWorkspace
    const tradingPartnerId = tradingPartnerIdOf(scope)

    const created = yield* writeInTransaction(async (tx) => {
      await assertTradingPartnerIn(tx, workspace.id, tradingPartnerId)

      const [row] = await tx
        .insert(lookupTables)
        .values({ workspaceId: workspace.id, tradingPartnerId, name, kind })
        .returning({ id: lookupTables.id })

      if (!row) {
        return undefined
      }

      await insertEntries(tx, row.id, entries)

      return selectLookupTable(tx, workspace.id, row.id)
    })

    return yield* Effect.orDie(Effect.fromNullishOr(created))
  })

export const updateLookupTable = (
  id: string,
  input: Effect.Effect<LookupTableInput, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadLookupTable(id)
    const { name, kind, scope, entries } = yield* input

    const workspace = yield* CurrentWorkspace
    const tradingPartnerId = tradingPartnerIdOf(scope)

    const rewritten = yield* writeInTransaction(async (tx) => {
      await assertTradingPartnerIn(tx, workspace.id, tradingPartnerId)

      return rewriteLookupTable(tx, workspace.id, id, { tradingPartnerId, name, kind }, () =>
        Promise.resolve(entries),
      )
    })

    return yield* foundOrNotFound(rewritten)
  })

export const deleteLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const deleted = yield* Effect.promise(() =>
      db
        .delete(lookupTables)
        .where(
          inWorkspace(lookupTables, workspace.id, eq(lookupTables.id, id), lookupTableUnused(id)),
        )
        .returning({ id: lookupTables.id }),
    )

    if (deleted.length === 0) {
      yield* rejectingUnknownLookupTable(id)

      return yield* new Conflict({ message: lookupTableInUseMessage })
    }
  })

export const previewLookupTableImport = (
  id: string,
  body: Effect.Effect<LookupTableImportBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const { entries } = yield* loadLookupTable(id)
    const { csv } = yield* body

    return { rows: classifyLookupTableImport(entries, csv) } satisfies LookupTableImportPreview
  })

export const importLookupTable = (
  id: string,
  body: Effect.Effect<LookupTableImportBody, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadLookupTable(id)
    const { csv } = yield* body

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rewritten = yield* Effect.promise(() =>
      db.transaction((tx) =>
        rewriteLookupTable(tx, workspace.id, id, {}, async () => {
          const entries = await selectEntries(tx, id)

          return applyLookupTableImport(entries, classifyLookupTableImport(entries, csv))
        }),
      ),
    )

    return yield* foundOrNotFound(rewritten)
  })
