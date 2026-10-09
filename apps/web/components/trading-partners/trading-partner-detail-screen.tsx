'use client'

import { PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { useChannelKindLabel } from '@/components/channels/channel-parts'
import { BackLink, Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import { useRunFilters } from '@/components/runs/run-filters-store'
import { RunLink } from '@/components/runs/run-link'
import { RunStatusBadge } from '@/components/runs/run-status'
import { OnboardingChecklist } from '@/components/trading-partners/onboarding-checklist'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { ApiError } from '@/lib/api/client'
import {
  channelsQuery,
  currentWorkspaceQuery,
  flowsQuery,
  runsQuery,
  tradingPartnerQuery,
} from '@/lib/api/queries'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { TradingPartner } from '@edi-bridge/contracts'

const recentRunCount = 10

function SectionBody<Item>({
  query,
  empty,
  failed,
  children,
}: {
  query: { data: Item[] | undefined; isPending: boolean; isError: boolean }
  empty: string
  failed: string
  children: (items: Item[]) => ReactNode
}) {
  if (query.isPending) {
    return <Skeleton className="h-16 w-full" />
  }

  if (query.isError || !query.data) {
    return <p className="text-sm text-red-800 dark:text-red-300">{failed}</p>
  }

  if (query.data.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty}</p>
  }

  return children(query.data)
}

function TradingPartnerFacts({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.facts')
  const tList = useTranslations('TradingPartners')

  return (
    <dl
      aria-label={t('label')}
      className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
      <Fact label={t('gln')}>
        <span className="font-mono tabular-nums">{tradingPartner.gln}</span>
      </Fact>
      <Fact label={t('characterSet')}>
        <span className="font-mono">{tradingPartner.characterSet}</span>
      </Fact>
      <Fact label={t('acknowledgementTimeLimit')}>
        {tList('hours', { hours: tradingPartner.acknowledgementTimeLimitHours })}
      </Fact>
      <Fact label={t('mode')}>
        <TestModeBadge testMode={tradingPartner.testMode} />
      </Fact>
    </dl>
  )
}

function TradingPartnerChannels({ tradingPartnerId }: { tradingPartnerId: string }) {
  const t = useTranslations('TradingPartner.channels')
  const kindLabel = useChannelKindLabel()

  const channels = useQuery({
    ...channelsQuery,
    select: (items) => items.filter((channel) => channel.tradingPartnerId === tradingPartnerId),
  })

  return (
    <Section id="trading-partner-channels" title={t('title')}>
      <SectionBody empty={t('none')} failed={t('failed')} query={channels}>
        {(items) => (
          <ul className="divide-y rounded-lg border">
            {items.map((channel) => (
              <li key={channel.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Link href={`/channels/${channel.id}`} className={linkClass}>
                  {channel.name}
                </Link>
                <span className="text-muted-foreground text-sm">{kindLabel(channel)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
    </Section>
  )
}

function TradingPartnerFlows({ tradingPartnerId }: { tradingPartnerId: string }) {
  const t = useTranslations('TradingPartner.flows')

  const flows = useQuery({
    ...flowsQuery,
    select: (items) => items.filter((flow) => flow.tradingPartnerId === tradingPartnerId),
  })

  return (
    <Section id="trading-partner-flows" title={t('title')}>
      <SectionBody empty={t('none')} failed={t('failed')} query={flows}>
        {(items) => (
          <ul className="divide-y rounded-lg border">
            {items.map((flow) => (
              <li key={flow.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="font-medium">{flow.name}</span>
                <code className="text-muted-foreground font-mono text-xs">{flow.messageType}</code>
              </li>
            ))}
          </ul>
        )}
      </SectionBody>
    </Section>
  )
}

function RecentRuns({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.runs')
  const tRuns = useTranslations('Runs')

  const runs = useQuery(
    runsQuery({ tradingPartnerId: [tradingPartner.id], page: 1, pageSize: recentRunCount }),
  )

  function showAllRuns() {
    const { clearFilters, setFilter } = useRunFilters.getState()
    clearFilters()
    setFilter('tradingPartnerId', [tradingPartner.id])
  }

  return (
    <Section id="trading-partner-runs" title={t('title')}>
      <SectionBody
        empty={t('none')}
        failed={t('failed')}
        query={{ ...runs, data: runs.data?.runs }}>
        {(items) => (
          <>
            <ul className="divide-y rounded-lg border">
              {items.map((run) => (
                <li
                  key={run.id}
                  className="relative flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <RunLink
                    description={tRuns('openRun', {
                      tradingPartner: run.tradingPartner.name,
                      messageType: run.messageType,
                    })}
                    run={run}
                  />
                  <RunStatusBadge status={run.status} />
                  <code className="font-mono text-xs">{run.messageType}</code>
                  <span className="text-muted-foreground">{run.flow.name}</span>
                </li>
              ))}
            </ul>
            <Link href="/runs" className={cn(linkClass, 'w-fit text-sm')} onClick={showAllRuns}>
              {t('viewAll', { count: runs.data?.total ?? 0 })}
            </Link>
          </>
        )}
      </SectionBody>
    </Section>
  )
}

function TradingPartnerView({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner')
  const workspace = useQuery(currentWorkspaceQuery)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tradingPartner.name}</h1>
          <TestModeBadge testMode={tradingPartner.testMode} />
        </div>
        <Link
          href={`/trading-partners/${tradingPartner.id}/edit`}
          className={buttonVariants({ variant: 'outline' })}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
          {t('edit')}
        </Link>
      </div>
      <TradingPartnerFacts tradingPartner={tradingPartner} />
      <Section id="trading-partner-onboarding" title={t('onboarding.title')}>
        {workspace.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <OnboardingChecklist
            tradingPartner={tradingPartner}
            workspaceGln={workspace.data?.gln ?? null}
          />
        )}
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <TradingPartnerChannels tradingPartnerId={tradingPartner.id} />
        <TradingPartnerFlows tradingPartnerId={tradingPartner.id} />
      </div>
      <RecentRuns tradingPartner={tradingPartner} />
    </>
  )
}

function TradingPartnerLoading() {
  const t = useTranslations('TradingPartner')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function TradingPartnerDetailScreen({ id }: { id: string }) {
  const t = useTranslations('TradingPartner')
  const { data, error, isPending, refetch } = useQuery(tradingPartnerQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/trading-partners" label={t('back')} />
      {isPending ? (
        <TradingPartnerLoading />
      ) : data ? (
        <TradingPartnerView tradingPartner={data} />
      ) : (
        <LoadFailure
          namespace="TradingPartner"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
