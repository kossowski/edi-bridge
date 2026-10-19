import { Effect } from 'effect'

import { type SecretBox, httpChannelDelivery, sftpChannelDelivery } from '@edi-bridge/channels'

import type { DeliveryService } from './services'

export const channelDelivery = (options: {
  secrets: SecretBox
  timeoutMs: number
}): DeliveryService => {
  const sftp = sftpChannelDelivery(options)
  const http = httpChannelDelivery(options)

  return (channel, document) => {
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
