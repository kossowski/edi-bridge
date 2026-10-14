import { Effect } from 'effect'

export const exactlyOne = <A>(rows: A[]) => Effect.orDie(Effect.fromNullishOr(rows[0]))
