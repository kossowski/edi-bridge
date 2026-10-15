import { Data } from 'effect'

import type { DocumentStructureProblem } from '@edi-bridge/contracts'

export class NotFound extends Data.TaggedError('NotFound') {
  override get message() {
    return 'Not found'
  }
}

export class Conflict extends Data.TaggedError('Conflict')<{ readonly message: string }> {}

export class Unprocessable extends Data.TaggedError('Unprocessable')<{
  readonly message: string
}> {}

export class DocumentStructureRejected extends Data.TaggedError('DocumentStructureRejected')<{
  readonly problem: DocumentStructureProblem
}> {
  override get message() {
    return this.problem.message
  }
}

export class Forbidden extends Data.TaggedError('Forbidden') {
  override get message() {
    return 'Forbidden'
  }
}
