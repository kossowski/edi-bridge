'use client'

import { useTranslations } from 'next-intl'

import { channelKindKey } from '@/components/channels/channel-form-values'
import { useLookup } from '@/hooks/use-lookup'
import { tradingPartnersQuery } from '@/lib/api/queries'

import type { Channel, ChannelKind, MaskedSecret } from '@edi-bridge/contracts'

export function useChannelKindLabel() {
  const t = useTranslations('ChannelKind')

  return (channel: ChannelKind) => t(`${channelKindKey(channel)}.label`)
}

export function useChannelTradingPartners() {
  const t = useTranslations('Channels')
  const tradingPartners = useLookup(tradingPartnersQuery)

  return {
    ...tradingPartners,
    name: (tradingPartnerId: string | null) =>
      tradingPartnerId === null
        ? t('ownSystems')
        : (tradingPartners.find(tradingPartnerId)?.name ?? t('unknownTradingPartner')),
  }
}

export function channelAddress(channel: Channel) {
  switch (channel.type) {
    case 'sftp':
      return `${channel.username}@${channel.host}:${channel.port}${channel.remotePath}`
    case 'webhook':
    case 'http':
      return channel.url
  }
}

export function MaskedSecretText({ secret }: { secret: MaskedSecret | null }) {
  const t = useTranslations('Channel.secret')

  if (secret === null) {
    return <span className="text-muted-foreground">{t('notSet')}</span>
  }

  return secret.lastFour === null ? (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="font-mono">
        ••••••••
      </span>
      {t('set')}
    </span>
  ) : (
    <span>
      <span aria-hidden className="font-mono">
        ••••••••{secret.lastFour}
      </span>
      <span className="sr-only">{t('endsIn', { lastFour: secret.lastFour })}</span>
    </span>
  )
}
