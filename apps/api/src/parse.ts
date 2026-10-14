import { Data, Effect } from 'effect'
import { z } from 'zod'

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly error: z.ZodError
}> {
  override get message() {
    return z.prettifyError(this.error)
  }
}

export function parse<Output, Input>(
  schema: z.ZodType<Output, Input>,
  input: Input,
): Effect.Effect<Output, ValidationError> {
  const result = schema.safeParse(input)

  return result.success
    ? Effect.succeed(result.data)
    : Effect.fail(new ValidationError({ error: result.error }))
}
