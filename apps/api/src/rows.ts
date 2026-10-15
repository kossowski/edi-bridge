import { and, type AnyColumn, DrizzleQueryError, eq, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import { Db, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { CurrentWorkspace } from './workspace.js'

export const exactlyOne = <A>(rows: A[]) => Effect.orDie(Effect.fromNullishOr(rows[0]))

export const foundOrNotFound = <A>(row: A | undefined) =>
  row === undefined ? Effect.fail(new NotFound()) : Effect.succeed(row)

export const rejectingInvalidId = (id: string) =>
  z.uuid().safeParse(id).success ? Effect.void : Effect.fail(new NotFound())

export const inWorkspace = (
  table: { workspaceId: AnyColumn },
  workspaceId: string,
  ...conditions: (SQL | undefined)[]
) => and(eq(table.workspaceId, workspaceId), ...conditions)

export const nameCollator = new Intl.Collator('de')

export const byName = (a: { name: string }, b: { name: string }) =>
  nameCollator.compare(a.name, b.name)

export const failingOnDuplicate =
  (constraints: readonly string[], message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchDefect((defect) =>
        defect instanceof DrizzleQueryError &&
        defect.cause instanceof postgres.PostgresError &&
        constraints.includes(defect.cause.constraint_name ?? '')
          ? Effect.fail(new Conflict({ message }))
          : Effect.die(defect),
      ),
    )

export const rejectingDuplicate = <A>(
  query: () => Promise<A>,
  constraints: readonly string[],
  message: string,
) => Effect.promise(query).pipe(failingOnDuplicate(constraints, message))

export const writingInWorkspace = <A>(
  write: (tx: Transaction, workspaceId: string) => Promise<A>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    return yield* Effect.promise(() => db.transaction((tx) => write(tx, workspace.id))).pipe(
      Effect.catchDefect((defect) =>
        defect instanceof Unprocessable || defect instanceof Conflict
          ? Effect.fail(defect)
          : Effect.die(defect),
      ),
    )
  })
