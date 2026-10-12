'use client'

import { Alert02Icon, CheckmarkCircle02Icon, UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { AppPage } from '@/components/app-page'
import { ListEmpty, NewLink } from '@/components/list-table'
import { LoadError } from '@/components/load-error'
import { partnerSetup } from '@/components/trading-partners/partner-setup'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import {
  currentWorkspaceQuery,
  tradingPartnerActivitiesQuery,
  tradingPartnersQuery,
} from '@/lib/api/queries'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Progress, ProgressLabel } from '@edi-bridge/ui/components/progress'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { TradingPartner, TradingPartnerActivity } from '@edi-bridge/contracts'

type PartnerActivity = Omit<TradingPartnerActivity, 'tradingPartnerId'>

const noActivity: PartnerActivity = {
  runsToday: 0,
  openProblems: 0,
  lastActivityAt: null,
  channelCount: 0,
  flowCount: 0,
}

function SetupProgress({
  tradingPartner,
  activity,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  activity: PartnerActivity
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartners.setup')

  if (!tradingPartner.testMode) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          aria-hidden
          className="text-primary size-4 shrink-0"
        />
        {t('complete')}
      </p>
    )
  }

  const { done, total, next } = partnerSetup(tradingPartner, activity, workspaceGln)
  const progress = t('progress', { done, total })

  return (
    <div className="flex flex-col gap-2">
      <Progress getAriaValueText={() => progress} value={(done / total) * 100}>
        <ProgressLabel>{t('label')}</ProgressLabel>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{progress}</span>
      </Progress>
      {next !== null && <p className="text-sm">{t('next', { step: t(`steps.${next}`) })}</p>}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  )
}

function PartnerCard({
  tradingPartner,
  activity,
  workspaceGln,
  now,
}: {
  tradingPartner: TradingPartner
  activity: PartnerActivity
  workspaceGln: string | null
  now: Date
}) {
  const t = useTranslations('TradingPartners')
  const tPartner = useTranslations('TradingPartner')
  const format = useFormatter()

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words">{tradingPartner.name}</h2>
          <TestModeBadge testMode={tradingPartner.testMode} />
        </CardTitle>
        {tradingPartner.gln === null ? (
          <CardDescription className="text-xs">{tPartner('noGln')}</CardDescription>
        ) : (
          <CardDescription className="font-mono text-xs tabular-nums">
            {tradingPartner.gln}
          </CardDescription>
        )}
        <CardAction>
          <Link
            href={`/trading-partners/${tradingPartner.id}`}
            className={buttonVariants({ size: 'sm' })}>
            {t.rich('open', {
              name: tradingPartner.name,
              hidden: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <SetupProgress
          activity={activity}
          tradingPartner={tradingPartner}
          workspaceGln={workspaceGln}
        />
        <dl className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3">
          <Fact label={t('facts.documentsToday')}>{format.number(activity.runsToday)}</Fact>
          <Fact label={t('facts.openProblems')}>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                activity.openProblems > 0 && 'text-destructive-text',
              )}>
              {activity.openProblems > 0 && (
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden className="size-4" />
              )}
              {format.number(activity.openProblems)}
            </span>
          </Fact>
          <Fact label={t('facts.lastActivity')}>
            {activity.lastActivityAt === null ? (
              <span className="text-muted-foreground font-normal">{t('facts.noActivity')}</span>
            ) : (
              <time
                dateTime={activity.lastActivityAt}
                title={format.dateTime(new Date(activity.lastActivityAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}>
                {format.relativeTime(new Date(activity.lastActivityAt), now)}
              </time>
            )}
          </Fact>
        </dl>
      </CardContent>
    </Card>
  )
}

function LoadingCards() {
  return Array.from({ length: 4 }, (_, index) => (
    <li key={index}>
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-1 w-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </li>
  ))
}

function byName(a: TradingPartner, b: TradingPartner) {
  return a.name.localeCompare(b.name)
}

export function TradingPartnersScreen() {
  const t = useTranslations()
  const now = useNow({ updateInterval: 60_000 })
  const tradingPartners = useQuery(tradingPartnersQuery)
  const activities = useQuery(tradingPartnerActivitiesQuery)
  const workspace = useQuery(currentWorkspaceQuery)
  const workspaceGln = workspace.data?.gln ?? null
  const busy = tradingPartners.isPending || activities.isPending || workspace.isPending
  const failed = tradingPartners.isError || activities.isError
  const empty = tradingPartners.data?.length === 0

  const activityOf = new Map(
    (activities.data ?? []).map(({ tradingPartnerId, ...activity }) => [
      tradingPartnerId,
      activity,
    ]),
  )

  function content() {
    if (failed) {
      return (
        <LoadError
          description={t('TradingPartners.error.description')}
          retryLabel={t('TradingPartners.error.retry')}
          title={t('TradingPartners.error.title')}
          onRetry={() => {
            void tradingPartners.refetch()
            void activities.refetch()
          }}
        />
      )
    }

    if (empty) {
      return (
        <ListEmpty
          action={
            <NewLink href="/trading-partners/new" label={t('TradingPartners.empty.action')} />
          }
          description={t('TradingPartners.empty.description')}
          icon={UserMultiple02Icon}
          title={t('TradingPartners.empty.title')}
          viewOnlyDescription={t('TradingPartners.empty.viewOnlyDescription')}
        />
      )
    }

    const shown = busy ? [] : [...(tradingPartners.data ?? [])].sort(byName)

    return (
      <div className="@container flex flex-col gap-3">
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {busy
            ? t('TradingPartners.loading')
            : t('TradingPartners.count', { count: shown.length })}
        </p>
        <ul
          aria-busy={busy}
          aria-label={t('TradingPartners.list')}
          className="grid gap-4 @4xl:grid-cols-2 @7xl:grid-cols-3">
          {busy ? (
            <LoadingCards />
          ) : (
            shown.map((tradingPartner) => (
              <li key={tradingPartner.id}>
                <PartnerCard
                  activity={activityOf.get(tradingPartner.id) ?? noActivity}
                  now={now}
                  tradingPartner={tradingPartner}
                  workspaceGln={workspaceGln}
                />
              </li>
            ))
          )}
        </ul>
      </div>
    )
  }

  return (
    <AppPage
      changeActions={
        !failed && !empty ? (
          <NewLink href="/trading-partners/new" label={t('TradingPartners.add')} />
        ) : undefined
      }
      title={t('Sidebar.items.tradingPartners.label')}
      className="gap-4">
      {content()}
    </AppPage>
  )
}
