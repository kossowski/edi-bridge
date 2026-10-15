import { and, type AnyColumn, DrizzleQueryError, eq, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import { Conflict, NotFound } from './errors.js'

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

export const rejectingDuplicate = <A>(
  query: () => Promise<A>,
  constraints: readonly string[],
  message: string,
) =>
  Effect.promise(query).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof DrizzleQueryError &&
      defect.cause instanceof postgres.PostgresError &&
      constraints.includes(defect.cause.constraint_name ?? '')
        ? Effect.fail(new Conflict({ message }))
        : Effect.die(defect),
    ),
  )
