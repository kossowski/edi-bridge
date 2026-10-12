import { channelKinds, type ChannelSummary, type Direction } from '@edi-bridge/contracts'

import { type ChannelKindKey, channelKindKey } from '../channels/channel-form-values'

const nameLength = 70

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

export function defaultKindKey(direction: Direction): ChannelKindKey {
  return kindKeysTravelling(direction)[0] ?? 'sftp-inbound'
}

export function suggestedName(name: string) {
  return name.slice(0, nameLength).trim()
}
