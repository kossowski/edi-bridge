import { and, asc, eq, getTableColumns, type SQL, sql } from 'drizzle-orm'
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
  type LookupTableSummary,
} from '@edi-bridge/contracts'
import {
  lookupTableEntries,
  lookupTables,
  lookupTableTradingPartnerNameUnique,
  lookupTableWorkspaceNameUnique,
  tradingPartners,
} from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { NotFound, Unprocessable } from './errors.js'
import { byName, exactlyOne, rejectingDuplicate, rejectingInvalidId } from './rows.js'
import { assertTradingPartnerIn } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const selectRows = (db: Database, where: SQL | undefined) =>
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

const toSummary = (row: Row): LookupTableSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  scope: scopeOf(row),
  entryCount: row.entryCount,
  // Until Mappings (#185) and Runs (#187) exist.
  uses: [],
  missingCodeCounts: { blocking: 0, upcoming: 0 },
  blockingCodes: [],
  updatedAt: row.updatedAt.toISOString(),
})

const inWorkspace = (workspaceId: string, ...conditions: (SQL | undefined)[]) =>
  and(eq(lookupTables.workspaceId, workspaceId), ...conditions)

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

  const rows = yield* Effect.promise(() => selectRows(db, inWorkspace(workspace.id)))

  return rows.map(toSummary).toSorted(byName)
})

export const loadLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      selectRows(db, inWorkspace(workspace.id, eq(lookupTables.id, id))),
    )

    if (!row) {
      return yield* new NotFound()
    }

    const entries = yield* Effect.promise(() => selectEntries(db, row.id))

    return {
      ...toSummary(row),
      entries,
      // Until code meanings are served (#181).
      codeMeanings: [],
    } satisfies LookupTable
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
    .where(inWorkspace(workspaceId, eq(lookupTables.id, id)))
    .returning({ id: lookupTables.id })

  if (locked.length === 0) {
    return false
  }

  const entries = await entriesOf()

  await tx.delete(lookupTableEntries).where(eq(lookupTableEntries.lookupTableId, id))
  await insertEntries(tx, id, entries)

  return true
}

// A DELETE between loadLookupTable and the rewrite leaves no row to write.
const reloadRewritten = (id: string, rewritten: boolean) =>
  rewritten ? loadLookupTable(id).pipe(Effect.orDie) : Effect.fail(new NotFound())

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

    const rows = yield* writeInTransaction(async (tx) => {
      await assertTradingPartnerIn(tx, workspace.id, tradingPartnerId)

      const created = await tx
        .insert(lookupTables)
        .values({ workspaceId: workspace.id, tradingPartnerId, name, kind })
        .returning({ id: lookupTables.id })

      const [row] = created

      if (row) {
        await insertEntries(tx, row.id, entries)
      }

      return created
    })

    const { id } = yield* exactlyOne(rows)

    return yield* loadLookupTable(id).pipe(Effect.orDie)
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

    return yield* reloadRewritten(id, rewritten)
  })

export const deleteLookupTable = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const deleted = yield* Effect.promise(() =>
      db
        .delete(lookupTables)
        .where(inWorkspace(workspace.id, eq(lookupTables.id, id)))
        .returning({ id: lookupTables.id }),
    )

    if (deleted.length === 0) {
      return yield* new NotFound()
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

    return yield* reloadRewritten(id, rewritten)
  })
