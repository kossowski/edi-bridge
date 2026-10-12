'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import {
  MaskedSecretText,
  useChannelKindLabel,
  useChannelTradingPartners,
} from '@/components/channels/channel-parts'
import { WebhookAccess } from '@/components/channels/webhook-token'
import { Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import { UploadSheet } from '@/components/documents/upload-sheet'
import { EditLink } from '@/components/edit-link'
import { ApiError } from '@/lib/api/client'
import { channelQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Channel } from '@edi-bridge/contracts'

function TradingPartnerFact({ tradingPartnerId }: { tradingPartnerId: string | null }) {
  const tradingPartners = useChannelTradingPartners()
  const tradingPartner = tradingPartners.find(tradingPartnerId)

  if (tradingPartnerId !== null && tradingPartners.isPending) {
    return <Skeleton className="h-4 w-32" />
  }

  return tradingPartner ? (
    <Link href={`/trading-partners/${tradingPartner.id}`} className={linkClass}>
      {tradingPartner.name}
    </Link>
  ) : (
    tradingPartners.name(tradingPartnerId)
  )
}

function ConnectionFacts({ channel }: { channel: Channel }) {
  const t = useTranslations('Channel.facts')
  const tChannel = useTranslations('Channel')

  switch (channel.type) {
    case 'sftp':
      return (
        <>
          <Fact label={t('host')}>
            <span className="font-mono break-all">{channel.host}</span>
          </Fact>
          <Fact label={t('port')}>
            <span className="font-mono tabular-nums">{channel.port}</span>
          </Fact>
          <Fact label={t('username')}>
            <span className="font-mono break-all">{channel.username}</span>
          </Fact>
          <Fact label={t(`remotePath.${channel.direction}`)}>
            <span className="font-mono break-all">{channel.remotePath}</span>
          </Fact>
          <Fact label={t('authentication')}>
            {tChannel(`authentication.${channel.authentication}`)}
          </Fact>
          <Fact label={tChannel(`authentication.${channel.authentication}`)}>
            <MaskedSecretText secret={channel.credential} />
          </Fact>
          {channel.direction === 'inbound' && (
            <Fact label={t('pollingInterval')}>
              {tChannel('every', { minutes: channel.pollingIntervalMinutes })}
            </Fact>
          )}
        </>
      )
    case 'webhook':
      return (
        <Fact label={t('rateLimit')}>
          {tChannel('perMinute', { count: channel.rateLimitPerMinute })}
        </Fact>
      )
    case 'http':
      return (
        <>
          <Fact label={t('url')}>
            <span className="font-mono break-all">{channel.url}</span>
          </Fact>
          <Fact label={t('authorization')}>
            <MaskedSecretText secret={channel.authorization} />
          </Fact>
        </>
      )
  }
}

function ChannelActions({ channel }: { channel: Channel }) {
  return (
    <>
      {channel.direction === 'inbound' && <UploadSheet defaultChannelId={channel.id} />}
      <EditLink href={`/channels/${channel.id}/edit`} />
    </>
  )
}

function ChannelView({ channel }: { channel: Channel }) {
  const t = useTranslations('Channel')
  const kindLabel = useChannelKindLabel()

  return (
    <>
      <dl
        aria-label={t('facts.label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
        <Fact label={t('facts.kind')}>{kindLabel(channel)}</Fact>
        <Fact label={t('facts.tradingPartner')}>
          <TradingPartnerFact tradingPartnerId={channel.tradingPartnerId} />
        </Fact>
        <ConnectionFacts channel={channel} />
      </dl>
      {channel.type === 'webhook' && (
        <Section id="channel-webhook" title={t('webhook.title')}>
          <WebhookAccess channel={channel} />
        </Section>
      )}
    </>
  )
}

function ChannelLoading() {
  const t = useTranslations('Channel')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function ChannelDetailScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useQuery(channelQuery(id))
  const kindLabel = useChannelKindLabel()

  return (
    <AppPage
      changeActions={data && <ChannelActions channel={data} />}
      meta={data && <Badge variant="outline">{kindLabel(data)}</Badge>}
      name={data?.name}>
      {isPending ? (
        <ChannelLoading />
      ) : data ? (
        <ChannelView channel={data} />
      ) : (
        <LoadFailure
          namespace="Channel"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
