'use client'

import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId } from 'react'

import { linkClass } from '@/components/detail-parts'
import { documentsHref } from '@/components/documents/document-filters'
import { LoadError } from '@/components/load-error'
import { MessageTypeName, usePlainNames } from '@/components/plain-names'
import { RunLink } from '@/components/runs/run-link'
import {
  dayTotals,
  type PartnerActivityProps,
  type PartnerPanelProps,
  problemKey,
} from '@/components/trading-partners/partner-page-helpers'
import { PartnerSetupCard } from '@/components/trading-partners/partner-setup-card'
import { tradingPartnerActivityQuery } from '@/lib/api/queries'
import { interchangeHref } from '@/lib/navigation'
import { type OpenProblem } from '@edi-bridge/contracts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

function OverviewCard({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  className?: string
  children: ReactNode
}) {
  const titleId = useId()

  return (
    <Card role="region" aria-labelledby={titleId} className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  )
}

function dayOf(date: string) {
  return new Date(`${date}T00:00:00.000Z`)
}

function DaysCard({ activity, tradingPartner }: PartnerActivityProps) {
  const t = useTranslations('TradingPartner.days')
  const format = useFormatter()
  const totals = dayTotals(activity.days)

  return (
    <OverviewCard
      description={
        totals.runs === 0
          ? t('empty')
          : [
              t('total', { count: totals.runs }),
              totals.failed > 0 && t('failedTotal', { count: totals.failed }),
            ]
              .filter(Boolean)
              .join(' · ')
      }
      title={t('title')}>
      <ul aria-label={t('caption', { name: tradingPartner.name })} className="flex flex-col gap-2">
        {activity.days.map((day) => {
          const delivered = day.runs - day.failed

          return (
            <li
              key={day.date}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <time dateTime={day.date} className="text-muted-foreground">
                {format.dateTime(dayOf(day.date), {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </time>
              <span aria-hidden className="bg-muted flex h-3 gap-0.5 overflow-hidden rounded-sm">
                {delivered > 0 && (
                  <span
                    className="bg-chart-1 rounded-sm"
                    style={{ width: `${(delivered / totals.busiest) * 100}%` }}
                  />
                )}
                {day.failed > 0 && (
                  <span
                    className="bg-destructive rounded-sm"
                    style={{ width: `${(day.failed / totals.busiest) * 100}%` }}
                  />
                )}
              </span>
              <span className="flex items-center justify-end gap-2 tabular-nums">
                <span>
                  <span aria-hidden>{format.number(day.runs)}</span>
                  <span className="sr-only">{t('documents', { count: day.runs })}</span>
                </span>
                {day.failed > 0 && (
                  <span className="text-destructive-text inline-flex items-center gap-1 font-medium">
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      strokeWidth={2}
                      aria-hidden
                      className="size-3.5"
                    />
                    <span aria-hidden>{format.number(day.failed)}</span>
                    <span className="sr-only">{t('failedTotal', { count: day.failed })}</span>
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </OverviewCard>
  )
}

function FlowsCard({ activity, tradingPartner }: PartnerActivityProps) {
  const t = useTranslations('TradingPartner.flows')

  return (
    <OverviewCard description={t('description')} title={t('title', { name: tradingPartner.name })}>
      {activity.flows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {activity.flows.map(({ flow, runs }) => (
            <li
              key={flow.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3 text-sm">
              <Link href={`/flows/${flow.id}`} className={cn(linkClass, 'min-w-0 break-words')}>
                {flow.name}
              </Link>
              <span className={cn('tabular-nums', runs === 0 && 'text-muted-foreground')}>
                {t('documents', { count: runs })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  )
}

function ProblemItem({ problem, now }: { problem: OpenProblem; now: Date }) {
  const t = useTranslations('TradingPartner.problems')
  const plainNames = usePlainNames()
  const format = useFormatter()

  if (problem.kind === 'failedRun') {
    const { run } = problem

    return (
      <li className="relative flex flex-col gap-1 p-3 text-sm">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <MessageTypeName messageType={run.messageType} />
          {run.failureStage && (
            <span className="text-destructive-text font-medium">
              {plainNames.failureStageTitle(run.failureStage)}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">
          <RunLink description={t('openRun')} run={run} />
        </span>
      </li>
    )
  }

  const { overdueAcknowledgement } = problem
  const { interchange } = overdueAcknowledgement

  return (
    <li className="flex flex-col gap-1 p-3 text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <MessageTypeName messageType={overdueAcknowledgement.messageType} />
        <span className="text-destructive-text font-medium">{t('overdue')}</span>
      </span>
      <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-2">
        <Link
          href={interchangeHref(interchange.controlReference)}
          aria-label={t('openInterchange', { controlReference: interchange.controlReference })}
          className={cn(linkClass, 'font-mono text-xs tabular-nums')}>
          {interchange.controlReference}
        </Link>
        {t.rich('overdueSince', {
          time: format.relativeTime(new Date(overdueAcknowledgement.overdueSince), now),
          when: (chunks) => (
            <time
              dateTime={overdueAcknowledgement.overdueSince}
              title={format.dateTime(new Date(overdueAcknowledgement.overdueSince), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}>
              {chunks}
            </time>
          ),
        })}
      </span>
    </li>
  )
}

function ProblemsCard({ activity, tradingPartner }: PartnerActivityProps) {
  const t = useTranslations('TradingPartner.problems')
  const now = useNow({ updateInterval: 60_000 })

  return (
    <OverviewCard title={t('title', { count: activity.openProblems })} className="lg:col-span-2">
      {activity.problems.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-success-text size-4 shrink-0"
          />
          {t('none')}
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {activity.problems.map((problem) => (
              <ProblemItem key={problemKey(problem)} now={now} problem={problem} />
            ))}
          </ul>
          {activity.openProblems > activity.problems.length && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="text-muted-foreground">
                {t('more', { shown: activity.problems.length, total: activity.openProblems })}
              </span>
              <Link
                href={documentsHref({ status: 'attention', tradingPartnerId: tradingPartner.id })}
                className={linkClass}>
                {t('showAll')}
              </Link>
            </p>
          )}
        </>
      )}
    </OverviewCard>
  )
}

export function PartnerLoading({ label }: { label: string }) {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  )
}

export function PartnerOverview({
  tradingPartner,
  onAddConnection,
  onAddDocument,
}: PartnerPanelProps & { onAddConnection: () => void; onAddDocument: () => void }) {
  const t = useTranslations('TradingPartner')
  const activity = useQuery(tradingPartnerActivityQuery(tradingPartner.id))

  if (activity.isPending) {
    return <PartnerLoading label={t('activity.loading')} />
  }

  if (activity.isError) {
    return (
      <LoadError
        description={t('activity.failed')}
        retryLabel={t('activity.retry')}
        title={t('activity.title')}
        onRetry={() => void activity.refetch()}
      />
    )
  }

  const props = { activity: activity.data, tradingPartner }

  return (
    <div className="flex flex-col gap-4">
      <PartnerSetupCard
        {...props}
        onAddConnection={onAddConnection}
        onAddDocument={onAddDocument}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <DaysCard {...props} />
        <FlowsCard {...props} />
        <ProblemsCard {...props} />
      </div>
    </div>
  )
}
