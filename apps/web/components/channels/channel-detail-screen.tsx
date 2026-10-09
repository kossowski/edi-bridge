'use client'

import { PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import {
  MaskedSecretText,
  useChannelKindLabel,
  useChannelTradingPartners,
} from '@/components/channels/channel-parts'
import { WebhookAccess } from '@/components/channels/webhook-token'
import { BackLink, Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'
import { ApiError } from '@/lib/api/client'
import { channelQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
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

function ChannelView({ channel }: { channel: Channel }) {
  const t = useTranslations('Channel')
  const kindLabel = useChannelKindLabel()

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{channel.name}</h1>
          <Badge variant="outline">{kindLabel(channel)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {channel.direction === 'inbound' && (
            <ManualSubmissionDialog defaultChannelId={channel.id} />
          )}
          <Link
            href={`/channels/${channel.id}/edit`}
            className={buttonVariants({ variant: 'outline' })}>
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
            {t('edit')}
          </Link>
        </div>
      </div>
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
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function ChannelDetailScreen({ id }: { id: string }) {
  const t = useTranslations('Channel')
  const { data, error, isPending, refetch } = useQuery(channelQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/channels" label={t('back')} />
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
    </div>
  )
}
