import { Data } from 'effect'

export class NotFound extends Data.TaggedError('NotFound') {
  override get message() {
    return 'Not found'
  }
}

export class Conflict extends Data.TaggedError('Conflict')<{ readonly message: string }> {}

export class Unprocessable extends Data.TaggedError('Unprocessable')<{
  readonly message: string
}> {}
