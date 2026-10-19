import { Data } from 'effect'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

export class DeliveryFailed extends Data.TaggedError('DeliveryFailed')<{
  readonly reason: ChannelTestFailureReason
  readonly httpStatus?: number
}> {}

export interface OutboundDocument {
  name: string
  content: Buffer
  mediaType?: string
}
