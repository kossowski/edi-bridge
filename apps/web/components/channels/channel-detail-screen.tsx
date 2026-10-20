'use client'

import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import {
  MaskedSecretText,
  useChannelKindLabel,
  useChannelTradingPartners,
} from '@/components/channels/channel-parts'
import { TestConnection } from '@/components/channels/channel-test'
import { WebhookAccess } from '@/components/channels/webhook-token'
import { Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import { ManualSubmissionSheet } from '@/components/documents/manual-submission-sheet'
import { EditLink } from '@/components/edit-link'
import { useCanChange } from '@/hooks/use-session'
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

type SftpChannel = Extract<Channel, { type: 'sftp' }>

function HostKey({ channel }: { channel: SftpChannel }) {
  const t = useTranslations('Channel.hostKey')
  const canChange = useCanChange()
  const confirmed = channel.hostKeyFingerprint ?? null

  return (
    <Section id="channel-host-key" title={t('title')}>
      {confirmed === null ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-amber-800 dark:text-amber-300"
          />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t('unchecked.title')}</p>
            <p>{t('unchecked.description')}</p>
            <p>{canChange ? t('unchecked.action') : t('unchecked.viewOnly')}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-mono break-all">{confirmed}</p>
          <p className="text-muted-foreground">{t('confirmed')}</p>
        </div>
      )}
      {canChange && (
        <div className="flex flex-wrap items-start gap-3">
          <TestConnection channel={channel} />
        </div>
      )}
    </Section>
  )
}

function ChannelActions({ channel }: { channel: Channel }) {
  return (
    <>
      {channel.direction === 'inbound' && <ManualSubmissionSheet defaultChannelId={channel.id} />}
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
      {channel.type === 'sftp' && <HostKey channel={channel} />}
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
