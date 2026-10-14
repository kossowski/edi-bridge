import { and, asc, DrizzleQueryError, eq, getTableColumns, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import {
  lookupTableEntries,
  lookupTables,
  lookupTableTradingPartnerNameUnique,
  lookupTableWorkspaceNameUnique,
  tradingPartners,
} from '@edi-bridge/db'

import type {
  LookupTable,
  LookupTableEntry,
  LookupTableInput,
  LookupTableScope,
  LookupTableScopeInput,
  LookupTableSummary,
} from '@edi-bridge/contracts'

import { Db, type Database } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

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

const selectEntries = (db: Database, lookupTableId: string) =>
  db
    .select({
      sourceCode: lookupTableEntries.sourceCode,
      targetCode: lookupTableEntries.targetCode,
    })
    .from(lookupTableEntries)
    .where(eq(lookupTableEntries.lookupTableId, lookupTableId))
    .orderBy(asc(lookupTableEntries.position))

const rejectingInvalidId = (id: string) =>
  z.uuid().safeParse(id).success ? Effect.void : Effect.fail(new NotFound())

const nameCollator = new Intl.Collator('de')

export const listLookupTables = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() => selectRows(db, inWorkspace(workspace.id)))

  return rows.map(toSummary).toSorted((a, b) => nameCollator.compare(a.name, b.name))
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

const assertTradingPartnerIn = async (
  tx: Transaction,
  workspaceId: string,
  tradingPartnerId: string | null,
) => {
  if (tradingPartnerId === null) {
    return
  }

  const [found] = await tx
    .select({ id: tradingPartners.id })
    .from(tradingPartners)
    .where(
      and(eq(tradingPartners.workspaceId, workspaceId), eq(tradingPartners.id, tradingPartnerId)),
    )
    .for('share')

  if (!found) {
    throw new Unprocessable({ message: 'Unknown Trading Partner' })
  }
}

const insertEntries = async (
  tx: Transaction,
  lookupTableId: string,
  entries: LookupTableEntry[],
) => {
  if (entries.length > 0) {
    await tx
      .insert(lookupTableEntries)
      .values(entries.map((entry, position) => ({ ...entry, lookupTableId, position })))
  }
}

const uniqueNames = new Set([lookupTableWorkspaceNameUnique, lookupTableTradingPartnerNameUnique])

const storing = (store: (db: Database) => Promise<string>) =>
  Effect.gen(function* () {
    const db = yield* Db

    const id = yield* Effect.promise(() => store(db)).pipe(
      Effect.catchDefect((defect): Effect.Effect<never, Conflict | NotFound | Unprocessable> => {
        if (defect instanceof NotFound || defect instanceof Unprocessable) {
          return Effect.fail(defect)
        }

        return defect instanceof DrizzleQueryError &&
          defect.cause instanceof postgres.PostgresError &&
          uniqueNames.has(defect.cause.constraint_name ?? '')
          ? Effect.fail(
              new Conflict({
                message: 'Another Lookup Table of this scope already uses this name',
              }),
            )
          : Effect.die(defect)
      }),
    )

    return yield* loadLookupTable(id).pipe(Effect.orDie)
  })

export const createLookupTable = ({ name, kind, scope, entries }: LookupTableInput) =>
  Effect.gen(function* () {
    const workspace = yield* CurrentWorkspace
    const tradingPartnerId = tradingPartnerIdOf(scope)

    return yield* storing((db) =>
      db.transaction(async (tx) => {
        await assertTradingPartnerIn(tx, workspace.id, tradingPartnerId)

        const [created] = await tx
          .insert(lookupTables)
          .values({ workspaceId: workspace.id, tradingPartnerId, name, kind })
          .returning({ id: lookupTables.id })

        if (!created) {
          throw new Error('Lookup Table insert returned no row')
        }

        await insertEntries(tx, created.id, entries)

        return created.id
      }),
    )
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

    return yield* storing((db) =>
      db.transaction(async (tx) => {
        await assertTradingPartnerIn(tx, workspace.id, tradingPartnerId)

        const [updated] = await tx
          .update(lookupTables)
          .set({ tradingPartnerId, name, kind, updatedAt: sql`now()` })
          .where(inWorkspace(workspace.id, eq(lookupTables.id, id)))
          .returning({ id: lookupTables.id })

        if (!updated) {
          throw new NotFound()
        }

        await tx.delete(lookupTableEntries).where(eq(lookupTableEntries.lookupTableId, id))
        await insertEntries(tx, id, entries)

        return id
      }),
    )
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
