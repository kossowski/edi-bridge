import { Data } from 'effect'

import type { ChannelTestFailureReason, RunErrorDetails } from '@edi-bridge/contracts'

export class DeliveryFailed extends Data.TaggedError('DeliveryFailed')<{
  readonly reason: ChannelTestFailureReason
  readonly details?: RunErrorDetails
}> {}

export interface OutboundDocument {
  name: string
  content: Buffer
  mediaType?: string
  isRetry?: boolean
}
