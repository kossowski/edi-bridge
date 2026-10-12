'use client'

import { Add01Icon, Alert02Icon, UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { partnerSetup } from '@/components/trading-partners/partner-setup'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { useCanChange } from '@/hooks/use-session'
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
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

function AddPartnerLink({ label }: { label: string }) {
  return (
    <Link href="/trading-partners/new" className={buttonVariants()}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
      {label}
    </Link>
  )
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
  const { done, total, next } = partnerSetup(tradingPartner, activity, workspaceGln)
  const progress = t('progress', { done, total })

  return (
    <div className="flex flex-col gap-2">
      <Progress getAriaValueText={() => progress} value={(done / total) * 100}>
        <ProgressLabel>{t('label')}</ProgressLabel>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{progress}</span>
      </Progress>
      <p className="text-sm">
        {next === null ? t('complete') : t('next', { step: t(`steps.${next}`) })}
      </p>
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
  const format = useFormatter()

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words">{tradingPartner.name}</h2>
          <TestModeBadge testMode={tradingPartner.testMode} />
        </CardTitle>
        <CardDescription className="font-mono text-xs tabular-nums">
          {tradingPartner.gln}
        </CardDescription>
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
        <dl className="mt-auto grid grid-cols-3 gap-3">
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

function EmptyPartners() {
  const t = useTranslations('TradingPartners.empty')
  const canChange = useCanChange()

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>
          {canChange ? t('description') : t('viewOnlyDescription')}
        </EmptyDescription>
      </EmptyHeader>
      {canChange && (
        <EmptyContent>
          <AddPartnerLink label={t('action')} />
        </EmptyContent>
      )}
    </Empty>
  )
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
      return <EmptyPartners />
    }

    const shown = busy ? [] : [...(tradingPartners.data ?? [])].sort(byName)

    return (
      <div className="flex flex-col gap-3">
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {busy
            ? t('TradingPartners.loading')
            : t('TradingPartners.count', { count: shown.length })}
        </p>
        <ul
          aria-busy={busy}
          aria-label={t('TradingPartners.list')}
          className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
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
        !failed && !empty ? <AddPartnerLink label={t('TradingPartners.add')} /> : undefined
      }
      title={t('Sidebar.items.tradingPartners.label')}
      className="gap-4">
      {content()}
    </AppPage>
  )
}
