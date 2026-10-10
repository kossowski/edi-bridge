'use client'

import { MailReceive01Icon, UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'

import { linkClass, rowLinkClass } from '@/components/detail-parts'
import { HealthStatusBadge } from '@/components/overview/health-status'
import { useFormats } from '@/components/overview/overview-formats'
import {
  errorRate,
  type OverdueAcknowledgement,
  type OverviewWindow,
  type TradingPartnerHealth,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

const topCount = 10

const numberClassName = 'text-right tabular-nums'

type Column = { key: string; label: string; numeric?: boolean }

function ListCard<Item>({
  title,
  description,
  caption,
  columns,
  items,
  empty,
  row,
  showAllLabel,
  showTopLabel,
}: {
  title: string
  description: string
  caption: string
  columns: ReadonlyArray<Column>
  items: ReadonlyArray<Item>
  empty: { icon: IconSvgElement; title: string; description: string }
  row: (item: Item) => ReactNode
  showAllLabel: string
  showTopLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const titleId = useId()
  const bodyId = useId()
  const shown = expanded ? items : items.slice(0, topCount)

  return (
    <Card role="region" aria-labelledby={titleId} className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={empty.icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>
                <h3>{empty.title}</h3>
              </EmptyTitle>
              <EmptyDescription>{empty.description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div
              role="group"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll wide tables
              tabIndex={0}
              aria-labelledby={titleId}
              className="focus-visible:ring-ring/50 overflow-x-auto rounded-lg border outline-none focus-visible:ring-[3px]">
              <table className="w-full caption-bottom text-sm">
                <TableCaption className="sr-only">{caption}</TableCaption>
                <TableHeader>
                  <TableRow>
                    {columns.map(({ key, label, numeric }) => (
                      <TableHead key={key} scope="col" className={numeric ? 'text-right' : ''}>
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody id={bodyId}>{shown.map(row)}</TableBody>
              </table>
            </div>
            {items.length > topCount && (
              <Button
                size="sm"
                variant="outline"
                aria-controls={bodyId}
                aria-expanded={expanded}
                className="self-start"
                onClick={() => setExpanded((value) => !value)}>
                {expanded ? showTopLabel : showAllLabel}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

const healthColumns = [
  { key: 'tradingPartner', numeric: false },
  { key: 'status', numeric: false },
  { key: 'delivered', numeric: true },
  { key: 'failed', numeric: true },
  { key: 'errorRate', numeric: true },
  { key: 'overdue', numeric: true },
  { key: 'lastRun', numeric: false },
] as const

type Formats = ReturnType<typeof useFormats>

function HealthRow({
  health,
  formats,
  noRunLabel,
}: {
  health: TradingPartnerHealth
  formats: Formats
  noRunLabel: string
}) {
  return (
    <TableRow className="relative">
      <TableCell>
        <Link href={`/trading-partners/${health.tradingPartner.id}`} className={rowLinkClass}>
          {health.tradingPartner.name}
        </Link>
      </TableCell>
      <TableCell>
        <HealthStatusBadge status={health.status} />
      </TableCell>
      <TableCell className={numberClassName}>{formats.count(health.delivered)}</TableCell>
      <TableCell className={numberClassName}>{formats.count(health.failed)}</TableCell>
      <TableCell className={numberClassName}>{formats.errorRate(errorRate(health))}</TableCell>
      <TableCell className={numberClassName}>{formats.count(health.overdue)}</TableCell>
      <TableCell className="tabular-nums">
        {health.lastRunAt === null ? (
          <span className="text-muted-foreground">{noRunLabel}</span>
        ) : (
          <time dateTime={health.lastRunAt}>{formats.dateTime(health.lastRunAt)}</time>
        )}
      </TableCell>
    </TableRow>
  )
}

export function TradingPartnerHealthList({
  tradingPartners,
  timeWindow,
}: {
  tradingPartners: ReadonlyArray<TradingPartnerHealth>
  timeWindow: OverviewWindow
}) {
  const t = useTranslations('Overview')
  const formats = useFormats(timeWindow)

  const count = (status: TradingPartnerHealth['status']) =>
    tradingPartners.filter((health) => health.status === status).length

  const unhealthy = count('failing') + count('degraded')

  return (
    <ListCard
      caption={t('health.caption', { period: t(`period.${timeWindow}`) })}
      columns={healthColumns.map(({ key, numeric }) => ({
        key,
        label: t(`health.columns.${key}`),
        numeric,
      }))}
      description={
        unhealthy === 0
          ? t('health.allHealthy', { count: tradingPartners.length })
          : t('health.summary', {
              failing: count('failing'),
              degraded: count('degraded'),
              healthy: count('healthy'),
            })
      }
      empty={{
        icon: UserMultiple02Icon,
        title: t('health.empty.title'),
        description: t('health.empty.description'),
      }}
      items={tradingPartners}
      row={(health) => (
        <HealthRow
          key={health.tradingPartner.id}
          formats={formats}
          health={health}
          noRunLabel={t('health.noRun')}
        />
      )}
      showAllLabel={t('health.showAll', { count: tradingPartners.length })}
      showTopLabel={t('showTop', { count: topCount })}
      title={t('health.title')}
    />
  )
}

const overdueColumns = [
  'interchange',
  'tradingPartner',
  'messageType',
  'sentAt',
  'timeLimit',
  'overdueSince',
] as const

function OverdueRow({
  acknowledgement,
  now,
  formats,
}: {
  acknowledgement: OverdueAcknowledgement
  now: Date
  formats: Formats
}) {
  const t = useTranslations('Overview.overdue')
  const format = useFormatter()

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/interchanges/${acknowledgement.interchange.id}`}
          aria-label={t('interchangeLink', {
            controlReference: acknowledgement.interchange.controlReference,
          })}
          className={cn(linkClass, 'font-mono text-xs tabular-nums')}>
          {acknowledgement.interchange.controlReference}
        </Link>
      </TableCell>
      <TableCell>
        <Link href={`/trading-partners/${acknowledgement.tradingPartner.id}`} className={linkClass}>
          {acknowledgement.tradingPartner.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-xs">{acknowledgement.messageType}</TableCell>
      <TableCell className="tabular-nums">
        <time dateTime={acknowledgement.sentAt}>{formats.dateTime(acknowledgement.sentAt)}</time>
      </TableCell>
      <TableCell className="tabular-nums">
        {t('hours', { hours: acknowledgement.acknowledgementTimeLimitHours })}
      </TableCell>
      <TableCell className="tabular-nums">
        <time dateTime={acknowledgement.overdueSince} className="flex flex-col">
          <span className="font-medium">
            {format.relativeTime(new Date(acknowledgement.overdueSince), now)}
          </span>
          <span className="text-muted-foreground text-xs">
            {formats.dateTime(acknowledgement.overdueSince)}
          </span>
        </time>
      </TableCell>
    </TableRow>
  )
}

export function OverdueAcknowledgementsList({
  overdueAcknowledgements,
  timeWindow,
}: {
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
  timeWindow: OverviewWindow
}) {
  const t = useTranslations('Overview')
  const now = useNow({ updateInterval: 60_000 })
  const formats = useFormats(timeWindow)

  return (
    <ListCard
      caption={t('overdue.caption')}
      columns={overdueColumns.map((key) => ({ key, label: t(`overdue.columns.${key}`) }))}
      description={t('overdue.description', { count: overdueAcknowledgements.length })}
      empty={{
        icon: MailReceive01Icon,
        title: t('overdue.empty.title'),
        description: t('overdue.empty.description'),
      }}
      items={overdueAcknowledgements}
      row={(acknowledgement) => (
        <OverdueRow
          key={acknowledgement.interchange.id}
          acknowledgement={acknowledgement}
          formats={formats}
          now={now}
        />
      )}
      showAllLabel={t('overdue.showAll', { count: overdueAcknowledgements.length })}
      showTopLabel={t('showTop', { count: topCount })}
      title={t('overdue.title')}
    />
  )
}

function ListCardSkeleton({ columns }: { columns: number }) {
  return (
    <Card aria-hidden className="min-w-0">
      <CardHeader>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                {Array.from({ length: columns }, (_, column) => (
                  <TableHead key={column}>
                    <Skeleton className="h-4 w-16" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }, (_, row) => (
                <TableRow key={row}>
                  {Array.from({ length: columns }, (_, column) => (
                    <TableCell key={column}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function LoadingLists() {
  return (
    <>
      <ListCardSkeleton columns={healthColumns.length} />
      <ListCardSkeleton columns={overdueColumns.length} />
    </>
  )
}
