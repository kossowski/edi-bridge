import { Data } from 'effect'

export const receiptRejections = {
  unknownChannel: 'The Channel does not exist',
  outboundChannel: 'A Document can only arrive on an inbound Channel',
  noFlow: 'No Flow routes Documents from this Channel',
  noRoutedMessage: 'No Flow on this Channel routes a Message of this Document',
} as const

export type ReceiptRejection = keyof typeof receiptRejections

export class ReceiptRejected extends Data.TaggedError('ReceiptRejected')<{
  readonly reason: ReceiptRejection
}> {
  override get message() {
    return receiptRejections[this.reason]
  }
}
