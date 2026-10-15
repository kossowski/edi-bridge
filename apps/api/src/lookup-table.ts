import { asc, eq, getTableColumns, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  applyLookupTableImport,
  classifyLookupTableImport,
  type LookupTable,
  type LookupTableEntry,
  type LookupTableImportBody,
  type LookupTableImportPreview,
  type LookupTableInput,
  type LookupTableScope,
  type LookupTableScopeInput,
  type LookupTableSuggestions,
  type LookupTableSuggestionsQuery,
  type LookupTableSummary,
  type LookupTableUse,
  type MissingCode,
} from '@edi-bridge/contracts'
import {
  lookupTableEntries,
  lookupTables,
  lookupTableTradingPartnerNameUnique,
  lookupTableWorkspaceNameUnique,
  tradingPartners,
} from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { lookupTableUnused, selectLookupTableUses } from './mapping-use.js'
import {
  byName,
  foundOrNotFound,
  inWorkspace,
  rejectingDuplicate,
  rejectingInvalidId,
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

const toSummary = (row: Row, uses: LookupTableUse[]): LookupTableSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  scope: scopeOf(row),
  entryCount: row.entryCount,
  uses,
  // Until Runs (#187) exist.
  missingCodeCounts: { blocking: 0, upcoming: 0 },
  blockingCodes: [],
  updatedAt: row.updatedAt.toISOString(),
})

const selectEntries = (db: Database | Transaction, lookupTableId: string) =>
  db
    .select({
      sourceCode: lookupTableEntries.sourceCode,
      targetCode: lookupTableEntries.targetCode,
    })
    .from(lookupTableEntries)
    .where(eq(lookupTableEntries.lookupTableId, lookupTableId))
    .orderBy(asc(lookupTableEntries.position))

export const listLookupTables = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const [rows, usesOf] = yield* Effect.promise(() =>
    Promise.all([
      selectRows(db, inWorkspace(lookupTables, workspace.id)),
      selectLookupTableUses(db, workspace.id),
    ]),
  )

  return rows.map((row) => toSummary(row, usesOf(row.id))).toSorted(byName)
})

const selectLookupTable = async (
  db: Database | Transaction,
  workspaceId: string,
  id: string,
): Promise<LookupTable | undefined> => {
  const [row] = await selectRows(
    db,
    inWorkspace(lookupTables, workspaceId, eq(lookupTables.id, id)),
  )

  if (!row) {
    return undefined
  }

  const usesOf = await selectLookupTableUses(db, workspaceId)

  return {
    ...toSummary(row, usesOf(row.id)),
    entries: await selectEntries(db, row.id),
    // Until code meanings are served (#228).
    codeMeanings: [],
  }
}

export const loadLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    return yield* foundOrNotFound(
      yield* Effect.promise(() => selectLookupTable(db, workspace.id, id)),
    )
  })

const rejectingUnknownLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [found] = yield* Effect.promise(() =>
      db
        .select({ id: lookupTables.id })
        .from(lookupTables)
        .where(inWorkspace(lookupTables, workspace.id, eq(lookupTables.id, id))),
    )

    if (!found) {
      return yield* new NotFound()
    }
  })

export const listLookupTableMissingCodes = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingUnknownLookupTable(id)

    // Until Mappings (#185) and Runs (#187) exist.
    return [] satisfies MissingCode[]
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
  Effect.gen(function* () {
    const db = yield* Db

    return yield* rejectingDuplicate(
      () => db.transaction(write),
      nameUniqueConstraints,
      'Another Lookup Table of this scope already uses this name',
    ).pipe(
      Effect.catchDefect((defect) =>
        defect instanceof Unprocessable ? Effect.fail(defect) : Effect.die(defect),
      ),
    )
  })

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
    yield* rejectingUnknownLookupTable(id)

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
      return yield* new Conflict({
        message: 'A Draft or published Mapping Version uses this Lookup Table.',
      })
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
