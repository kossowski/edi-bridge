import { Data } from 'effect'

import type { TestInterchangeRefusal } from '@edi-bridge/contracts'

export const receiptRejections = {
  unknownChannel: 'The Channel does not exist',
  outboundChannel: 'A Document can only arrive on an inbound Channel',
  noFlow: 'No Flow routes Documents from this Channel',
  noRoutedMessage: 'No Flow on this Channel routes a Message of this Document',
  ambiguousFlow: 'Several outbound Flows on this Channel could take this Document',
} as const

export type ReceiptRejection = keyof typeof receiptRejections

export class ReceiptRejected extends Data.TaggedError('ReceiptRejected')<{
  readonly reason: ReceiptRejection
  // So the poller can tell a stored file from an unstored one.
  readonly documentId?: string
}> {
  override get message() {
    return receiptRejections[this.reason]
  }
}

export class RunNotQueued extends Data.TaggedError('RunNotQueued')<{
  readonly runId: string
  readonly cause: unknown
}> {
  override get message() {
    return `Run ${this.runId} was received but could not be queued for processing`
  }
}

export class RunNotRetryable extends Data.TaggedError('RunNotRetryable')<{
  readonly runId: string
}> {
  override get message() {
    return 'Only a Run that failed at delivery with something stored to deliver can be retried'
  }
}

export const documentExpiredMessage =
  'The Document of the Run expired, so the Run cannot be reprocessed'

export class RunNotReprocessable extends Data.TaggedError('RunNotReprocessable')<{
  readonly runId: string
  readonly documentExpired?: boolean
}> {
  override get message() {
    if (this.documentExpired === true) {
      return documentExpiredMessage
    }

    return 'Only a failed Run that is not replaced yet and that neither the Trading Partner nor a Retry fixes can be reprocessed'
  }
}

export class MappingVersionNotOfRun extends Data.TaggedError('MappingVersionNotOfRun')<{
  readonly runId: string
  readonly mappingVersionId: string
}> {
  override get message() {
    return 'The Mapping Version does not belong to the Mapping of the Run'
  }
}

export class TestInterchangeRefused extends Data.TaggedError('TestInterchangeRefused')<{
  readonly refusal: TestInterchangeRefusal
}> {}
