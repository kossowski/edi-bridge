import { Data, Effect } from 'effect'
import { z } from 'zod'

export class SchemaMismatch extends Data.TaggedError('SchemaMismatch')<{
  readonly error: z.ZodError
}> {
  override get message() {
    return z.prettifyError(this.error)
  }
}

export function parse<Output, Stored>(
  schema: z.ZodType<Output>,
  input: Stored,
): Effect.Effect<Output, SchemaMismatch> {
  const result = schema.safeParse(input)

  return result.success
    ? Effect.succeed(result.data)
    : Effect.fail(new SchemaMismatch({ error: result.error }))
}
