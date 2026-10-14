import { DrizzleQueryError } from 'drizzle-orm'
import { Effect } from 'effect'
import postgres from 'postgres'
import { z } from 'zod'

import { Conflict, NotFound } from './errors.js'

export const exactlyOne = <A>(rows: A[]) => Effect.orDie(Effect.fromNullishOr(rows[0]))

export const rejectingInvalidId = (id: string) =>
  z.uuid().safeParse(id).success ? Effect.void : Effect.fail(new NotFound())

const nameCollator = new Intl.Collator('de')

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
