'use client'

import { ChartLineData01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LiveIndicator } from '@/components/live-indicator'
import { LoadError } from '@/components/load-error'
import { BucketTable, ErrorRateChart, ThroughputChart } from '@/components/overview/overview-charts'
import { type Totals, toBucketRows, totalsOf } from '@/components/overview/overview-data'
import { useFormats } from '@/components/overview/overview-formats'
import {
  LoadingLists,
  OverdueAcknowledgementsList,
  TradingPartnerHealthList,
} from '@/components/overview/overview-lists'
import { useLiveEvents } from '@/hooks/use-live-events'
import { overviewKeys, overviewQuery } from '@/lib/api/queries'
import { type OverviewWindow, overviewWindows } from '@edi-bridge/contracts'
import { Card } from '@edi-bridge/ui/components/card'
import {
  Empty,
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
  onChange: (timeWindow: OverviewWindow) => void
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
        const timeWindow = overviewWindows.find((candidate) => candidate === next[0])

        if (timeWindow) {
          onChange(timeWindow)
        }
      }}>
      {overviewWindows.map((timeWindow) => (
        <ToggleGroupItem key={timeWindow} value={timeWindow}>
          {t(timeWindow)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const kpis = ['finished', 'delivered', 'failed', 'errorRate'] as const

function Kpis({ totals, timeWindow }: { totals: Totals | undefined; timeWindow: OverviewWindow }) {
  const t = useTranslations('Overview')
  const formats = useFormats(timeWindow)

  function kpiValue(kpi: (typeof kpis)[number]) {
    if (!totals) {
      return <Skeleton className="h-8 w-20" />
    }

    return kpi === 'errorRate' ? formats.errorRate(totals.errorRate) : formats.count(totals[kpi])
  }

  return (
    <dl
      aria-label={t('kpis.label', { period: t(`period.${timeWindow}`) })}
      className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card key={kpi} size="sm" className="gap-1">
          <dt className="text-muted-foreground px-3 text-sm">
            {kpi === 'finished' ? t('kpis.finished') : t(`series.${kpi}`)}
          </dt>
          <dd className="mt-auto px-3 text-2xl font-semibold tracking-tight">{kpiValue(kpi)}</dd>
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
  const [timeWindow, setTimeWindow] = useState<OverviewWindow>(defaultWindow)
  const queryClient = useQueryClient()
  const liveStatus = useLiveEvents()

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(
    overviewQuery(timeWindow),
  )

  const shownWindow = data?.window ?? timeWindow
  const fetchedAt = queryClient.getQueryState(overviewKeys.window(shownWindow))?.dataUpdatedAt ?? 0
  const rows = data && toBucketRows(data.throughput, fetchedAt)
  const totals = rows && totalsOf(rows)
  const busy = isPending || isPlaceholderData

  return (
    <AppPage
      actions={<WindowSwitch value={timeWindow} onChange={setTimeWindow} />}
      meta={<LiveIndicator status={liveStatus} />}
      title={t('Navigation.overview')}
      className="gap-6">
      <p aria-live="polite" className="sr-only">
        {busy && !isError ? t('Overview.loading') : ''}
      </p>
      {isError ? (
        <LoadError
          description={t('Overview.error.description')}
          retryLabel={t('Overview.error.retry')}
          title={t('Overview.error.title')}
          onRetry={() => void refetch()}
        />
      ) : (
        <div
          aria-busy={busy}
          className={cn(
            'flex flex-col gap-4',
            isPlaceholderData && 'opacity-60 transition-opacity',
          )}>
          <Kpis timeWindow={shownWindow} totals={totals} />
          {!rows || !totals ? (
            <LoadingCharts />
          ) : totals.finished === 0 ? (
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
                <ThroughputChart rows={rows} timeWindow={shownWindow} totals={totals} />
                <ErrorRateChart rows={rows} timeWindow={shownWindow} totals={totals} />
              </div>
              <BucketTable rows={rows} timeWindow={shownWindow} />
            </>
          )}
          {data ? (
            <>
              <TradingPartnerHealthList
                timeWindow={shownWindow}
                tradingPartners={data.tradingPartners}
              />
              <OverdueAcknowledgementsList
                overdueAcknowledgements={data.overdueAcknowledgements}
                timeWindow={shownWindow}
              />
            </>
          ) : (
            <LoadingLists />
          )}
        </div>
      )}
    </AppPage>
  )
}
