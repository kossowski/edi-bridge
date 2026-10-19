import { Data } from 'effect'

export const receiptRejections = {
  unknownChannel: 'The Channel does not exist',
  outboundChannel: 'A Document can only arrive on an inbound Channel',
  noFlow: 'No Flow routes Documents from this Channel',
  noRoutedMessage: 'No Flow on this Channel routes a Message of this Document',
  ambiguousFlow: 'Several outbound Flows on this Channel could take this Document',
  inboundNotProcessed: 'Documents for inbound Flows are not processed yet',
} as const

export type ReceiptRejection = keyof typeof receiptRejections

export class ReceiptRejected extends Data.TaggedError('ReceiptRejected')<{
  readonly reason: ReceiptRejection
}> {
  override get message() {
    return receiptRejections[this.reason]
  }
}

// The Run is recorded as received, but no worker will pick it up until it is queued again.
export class RunNotQueued extends Data.TaggedError('RunNotQueued')<{
  readonly runId: string
  readonly cause: unknown
}> {
  override get message() {
    return `Run ${this.runId} was received but could not be queued for processing`
  }
}
