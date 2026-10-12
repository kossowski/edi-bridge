import {
  channelKinds,
  type ChannelSummary,
  type Direction,
  maxChannelNameLength,
} from '@edi-bridge/contracts'

import { type ChannelKindKey, channelKindKey } from '../channels/channel-form-values'

export function partnerConnections<Item extends Pick<ChannelSummary, 'tradingPartnerId'>>(
  channels: ReadonlyArray<Item>,
  tradingPartnerId: string,
) {
  const own: Item[] = []
  const shared: Item[] = []

  for (const channel of channels) {
    if (channel.tradingPartnerId === tradingPartnerId) {
      own.push(channel)
    } else if (channel.tradingPartnerId === null) {
      shared.push(channel)
    }
  }

  return { own, shared }
}

export function kindKeysTravelling(direction: Direction): ReadonlyArray<ChannelKindKey> {
  return channelKinds.flatMap((kind) =>
    kind.direction === direction ? [channelKindKey(kind)] : [],
  )
}

const defaultKindKeys = {
  inbound: 'sftp-inbound',
  outbound: 'sftp-outbound',
} as const satisfies { [Way in Direction]: Extract<ChannelKindKey, `${string}-${Way}`> }

export function defaultKindKey(direction: Direction): ChannelKindKey {
  return defaultKindKeys[direction]
}

export function suggestedName(name: string) {
  return name.slice(0, maxChannelNameLength).trim()
}
