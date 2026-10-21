import { channelSettingsHref } from '@/lib/navigation'

import type { Channel, ChannelTestFailureReason, PollProblem } from '@edi-bridge/contracts'

export type PollProblemFix = {
  target: 'hostKey' | 'credentials' | 'address' | 'settings'
  href: string
}

type ChannelKind = { type: string; direction: string }

export function isInboundSftp<T extends ChannelKind>(
  channel: T,
): channel is Extract<T, { type: 'sftp'; direction: 'inbound' }> {
  return channel.type === 'sftp' && channel.direction === 'inbound'
}

export function pollProblemOf(channel: Channel): PollProblem | null {
  return isInboundSftp(channel) ? channel.pollProblem : null
}

export function pollProblemFix(
  channelId: string,
  reason: ChannelTestFailureReason,
): PollProblemFix {
  switch (reason) {
    case 'hostKeyMismatch':
      return { target: 'hostKey', href: `/channels/${channelId}#channel-host-key` }
    case 'loginRejected':
      return { target: 'credentials', href: channelSettingsHref(channelId) }
    case 'addressBlocked':
      return { target: 'address', href: channelSettingsHref(channelId) }
    default:
      return { target: 'settings', href: channelSettingsHref(channelId) }
  }
}

// Only the addressBlocked title takes the address; the other titles ignore it.
export function failureValues(failure: { blockedAddress?: string | undefined }) {
  return { address: failure.blockedAddress ?? '' }
}
