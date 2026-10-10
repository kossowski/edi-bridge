'use client'

import { AlertCircleIcon, ChartLineData01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { BucketTable, ErrorRateChart, ThroughputChart } from '@/components/overview/overview-charts'
import { type BucketRow, toBucketRows, totalsOf } from '@/components/overview/overview-data'
import { overviewQuery } from '@/lib/api/queries'
import { type OverviewWindow, overviewWindows } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Card } from '@edi-bridge/ui/components/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'
import { cn } from '@edi-bridge/ui/lib/utils'

function WindowSwitch({
  value,
  onChange,
}: {
  value: OverviewWindow
  onChange: (window: OverviewWindow) => void
}) {
  const t = useTranslations('Overview.window')

  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      value={[value]}
      variant="outline"
      aria-label={t('label')}
      onValueChange={(next) => {
        const window = overviewWindows.find((candidate) => candidate === next[0])

        if (window) {
          onChange(window)
        }
      }}>
      {overviewWindows.map((window) => (
        <ToggleGroupItem key={window} value={window}>
          {t(window)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const kpis = ['finished', 'delivered', 'failed', 'errorRate'] as const

function Kpis({ rows, window }: { rows: BucketRow[] | undefined; window: OverviewWindow }) {
  const t = useTranslations('Overview')
  const format = useFormatter()
  const totals = rows && totalsOf(rows)

  function valueOf(kpi: (typeof kpis)[number]) {
    if (!totals) {
      return <Skeleton className="h-8 w-20" />
    }

    if (kpi === 'errorRate') {
      return totals.errorRate === null
        ? t('kpis.noErrorRate')
        : format.number(totals.errorRate, { style: 'percent', maximumFractionDigits: 1 })
    }

    return format.number(totals[kpi])
  }

  return (
    <dl
      aria-label={t('kpis.label', { period: t(`period.${window}`) })}
      className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi} size="sm" className="gap-1">
          <dt className="text-muted-foreground px-3 text-sm">{t(`kpis.${kpi}`)}</dt>
          <dd className="px-3 text-2xl font-semibold tracking-tight">{valueOf(kpi)}</dd>
        </Card>
      ))}
    </dl>
  )
}

function LoadingCharts() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((index) => (
        <Card key={index}>
          <div className="flex flex-col gap-3 px-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-64 w-full" />
          </div>
        </Card>
      ))}
    </div>
  )
}

export function OverviewScreen({ defaultWindow = '24h' }: { defaultWindow?: OverviewWindow }) {
  const t = useTranslations()
  const [window, setWindow] = useState<OverviewWindow>(defaultWindow)
  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(overviewQuery(window))
  const rows = data && toBucketRows(data.throughput)
  const shownWindow = data?.window ?? window
  const busy = isPending || isPlaceholderData

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Navigation.overview')}</h1>
        <WindowSwitch value={window} onChange={setWindow} />
      </div>
      <p aria-live="polite" className="sr-only">
        {busy ? t('Overview.loading') : ''}
      </p>
      {isError && !data ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{t('Overview.error.title')}</EmptyTitle>
            <EmptyDescription>{t('Overview.error.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void refetch()}>
              {t('Overview.error.retry')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div
          aria-busy={busy}
          className={cn(
            'flex flex-col gap-4',
            isPlaceholderData && 'opacity-60 transition-opacity',
          )}>
          <Kpis rows={rows} window={shownWindow} />
          {!rows ? (
            <LoadingCharts />
          ) : totalsOf(rows).finished === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ChartLineData01Icon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>{t('Overview.empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {t('Overview.empty.description', { period: t(`Overview.period.${shownWindow}`) })}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <ThroughputChart rows={rows} window={shownWindow} />
                <ErrorRateChart rows={rows} window={shownWindow} />
              </div>
              <BucketTable rows={rows} window={shownWindow} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
