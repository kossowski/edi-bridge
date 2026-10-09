'use client'

import { useFormatter, useTranslations } from 'next-intl'

import { useChannelTradingPartners } from '@/components/channels/channel-parts'
import { useLookup } from '@/hooks/use-lookup'
import { channelsQuery } from '@/lib/api/queries'

import type { MappingVersionSummary } from '@edi-bridge/contracts'

export function useFlowChannels() {
  const t = useTranslations('Flow')
  const channels = useLookup(channelsQuery)

  return {
    ...channels,
    name: (id: string) => channels.find(id)?.name ?? t('unknownChannel'),
  }
}

export function useFlowReferences() {
  const tradingPartners = useChannelTradingPartners()
  const channels = useFlowChannels()

  return {
    isPending: tradingPartners.isPending || channels.isPending,
    tradingPartners,
    channels,
  }
}

export function useMappingVersionLabel() {
  const t = useTranslations('Flow')

  return ({ mappingName, version }: MappingVersionSummary) =>
    t('mappingVersion', { mappingName, version })
}

export function useVersionOptionLabel() {
  const t = useTranslations('Flow')
  const format = useFormatter()

  return ({ version, publishedAt }: MappingVersionSummary) =>
    t('versionOption', {
      version,
      publishedAt: format.dateTime(new Date(publishedAt), { dateStyle: 'medium' }),
    })
}
