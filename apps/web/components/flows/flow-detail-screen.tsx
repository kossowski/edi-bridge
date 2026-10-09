'use client'

import { PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { useChannelKindLabel } from '@/components/channels/channel-parts'
import { BackLink, Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import {
  useFlowChannels,
  useFlowReferences,
  useMappingVersionLabel,
} from '@/components/flows/flow-parts'
import { MoveMappingVersion } from '@/components/flows/move-mapping-version'
import { ApiError } from '@/lib/api/client'
import { flowQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Flow } from '@edi-bridge/contracts'

function ChannelFact({ id }: { id: string }) {
  const channels = useFlowChannels()
  const kindLabel = useChannelKindLabel()
  const channel = channels.find(id)

  if (channels.isPending) {
    return <Skeleton className="h-4 w-32" />
  }

  return channel ? (
    <span className="flex flex-col">
      <Link href={`/channels/${channel.id}`} className={linkClass}>
        {channel.name}
      </Link>
      <span className="text-muted-foreground">{kindLabel(channel)}</span>
    </span>
  ) : (
    channels.name(id)
  )
}

function TradingPartnerFact({ tradingPartnerId }: { tradingPartnerId: string }) {
  const { tradingPartners } = useFlowReferences()
  const tradingPartner = tradingPartners.find(tradingPartnerId)

  if (tradingPartners.isPending) {
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

function PinnedMappingVersion({ flow }: { flow: Flow }) {
  const t = useTranslations('Flow.pinned')
  const format = useFormatter()
  const versionLabel = useMappingVersionLabel()
  const [movedTo, setMovedTo] = useState<number | null>(null)
  const done = useRef<HTMLParagraphElement>(null)
  const tMove = useTranslations('Flow.move')
  const { mappingVersion, newerMappingVersions } = flow
  const latest = newerMappingVersions[0]

  useEffect(() => {
    if (movedTo !== null) {
      done.current?.focus()
    }
  }, [movedTo])

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{versionLabel(mappingVersion)}</p>
        <p className="text-muted-foreground text-sm">
          {t('published', {
            publishedAt: format.dateTime(new Date(mappingVersion.publishedAt), {
              dateStyle: 'medium',
            }),
          })}
        </p>
      </div>
      <p ref={done} role="status" tabIndex={-1} className="text-sm outline-none empty:hidden">
        {movedTo !== null && tMove('done', { version: movedTo })}
      </p>
      <p className="text-sm">
        {latest
          ? t('newer', { count: newerMappingVersions.length, latest: latest.version })
          : t('newest')}
      </p>
      <MoveMappingVersion flow={flow} onMoved={setMovedTo} />
    </div>
  )
}

function FlowView({ flow }: { flow: Flow }) {
  const t = useTranslations('Flow')

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{flow.name}</h1>
          <Badge variant="outline">{flow.messageType}</Badge>
        </div>
        <Link href={`/flows/${flow.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
          {t('edit')}
        </Link>
      </div>
      <dl
        aria-label={t('facts.label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
        <Fact label={t('facts.messageType')}>
          <code className="font-mono">{flow.messageType}</code>
        </Fact>
        <Fact label={t('facts.tradingPartner')}>
          <TradingPartnerFact tradingPartnerId={flow.tradingPartnerId} />
        </Fact>
        <Fact label={t('facts.inboundChannel')}>
          <ChannelFact id={flow.inboundChannelId} />
        </Fact>
        <Fact label={t('facts.destinationChannel')}>
          <ChannelFact id={flow.destinationChannelId} />
        </Fact>
      </dl>
      <Section id="flow-mapping-version" title={t('pinned.title')}>
        <PinnedMappingVersion flow={flow} />
      </Section>
    </>
  )
}

function FlowLoading() {
  const t = useTranslations('Flow')

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

export function FlowDetailScreen({ id }: { id: string }) {
  const t = useTranslations('Flow')
  const { data, error, isPending, refetch } = useQuery(flowQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/flows" label={t('back')} />
      {isPending ? (
        <FlowLoading />
      ) : data ? (
        <FlowView flow={data} />
      ) : (
        <LoadFailure
          namespace="Flow"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
