import { Data } from 'effect'

import type { ChannelTestFailureReason, RunErrorDetails } from '@edi-bridge/contracts'

import type { ChannelUnreachable } from './channel-reach'

export class DeliveryFailed extends Data.TaggedError('DeliveryFailed')<{
  readonly reason: ChannelTestFailureReason
  readonly details?: RunErrorDetails
}> {}

export const deliveryFailed = ({ reason, blockedAddress }: ChannelUnreachable) =>
  new DeliveryFailed(
    blockedAddress === undefined
      ? { reason }
      : { reason, details: { kind: 'blockedAddress', address: blockedAddress } },
  )

export interface OutboundDocument {
  name: string
  content: Buffer
  mediaType?: string
  isRetry?: boolean
}
