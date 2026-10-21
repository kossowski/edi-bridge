import { Effect } from 'effect'

import {
  type ConnectOptions,
  type SecretBox,
  httpChannelDelivery,
  sftpChannelDelivery,
} from '@edi-bridge/channels'

import type { DeliveryService } from './services'

export const channelDelivery = (
  options: ConnectOptions & { secrets: SecretBox },
): DeliveryService => {
  const sftp = sftpChannelDelivery(options)
  const http = httpChannelDelivery(options)

  return (channel, document) => {
    // The pipeline stops a seeded Channel before it gets here; this keeps any other caller off its host.
    if (channel.seeded) {
      return Effect.die(new Error(`Seeded Channel ${channel.id} never sends`))
    }

    switch (channel.type) {
      case 'sftp':
        return sftp(channel, document)
      case 'http':
        return http(channel, document)
      case 'webhook':
        return Effect.die(new Error(`Webhook Channel ${channel.id} takes no deliveries`))
    }
  }
}
