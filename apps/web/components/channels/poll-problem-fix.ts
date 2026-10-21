import type { Channel, ChannelTestFailureReason, PollProblem } from '@edi-bridge/contracts'

export type PollProblemFix = { target: 'hostKey' | 'credentials' | 'settings'; href: string }

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
      return { target: 'credentials', href: `/channels/${channelId}/edit` }
    default:
      return { target: 'settings', href: `/channels/${channelId}/edit` }
  }
}
