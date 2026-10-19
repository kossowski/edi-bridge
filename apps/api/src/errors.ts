import { Data } from 'effect'

import {
  type DocumentStructureProblem,
  type InviteUnusableReason,
  inviteUnusableMessages,
} from '@edi-bridge/contracts'

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

export class InviteUnusable extends Data.TaggedError('InviteUnusable')<{
  readonly reason: InviteUnusableReason
}> {
  override get message() {
    return inviteUnusableMessages[this.reason]
  }
}

export class AiReviewOpen extends Data.TaggedError('AiReviewOpen') {
  override get message() {
    return 'The AI review of the Draft is still open.'
  }
}
