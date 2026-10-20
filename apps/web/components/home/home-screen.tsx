'use client'

import { ChartLineData01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { BucketTable, ErrorRateChart, ThroughputChart } from '@/components/home/home-charts'
import { toBucketRows, totalsOf } from '@/components/home/home-data'
import { HomeDraftPromo } from '@/components/home/home-draft-promo'
import { HomeKeyNumbers } from '@/components/home/home-key-numbers'
import { HomeSetupLink } from '@/components/home/home-setup-link'
import { HomeTradingPartners } from '@/components/home/home-trading-partners'
import { useLiveStatus } from '@/components/live-events-provider'
import { LiveIndicator } from '@/components/live-indicator'
import { LoadError } from '@/components/load-error'
import { firstStepsQuery, homeKeys, homeQuery } from '@/lib/api/queries'
import { navigationItems } from '@/lib/navigation'
import { firstStepsProgress, type HomeWindow, homeWindows } from '@edi-bridge/contracts'
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
  value: HomeWindow
  onChange: (timeWindow: HomeWindow) => void
}) {
  const t = useTranslations('Home.window')

  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      value={[value]}
      variant="outline"
      aria-label={t('label')}
      onValueChange={(next) => {
        const timeWindow = homeWindows.find((candidate) => candidate === next[0])

        if (timeWindow) {
          onChange(timeWindow)
        }
      }}>
      {homeWindows.map((timeWindow) => (
        <ToggleGroupItem key={timeWindow} value={timeWindow}>
          {t(timeWindow)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function LoadingCharts() {
  return (
    <div aria-hidden className="grid gap-4 lg:grid-cols-2">
      {[0, 1].map((index) => (
        <Card key={index}>
          <div className="flex flex-col gap-3 px-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </Card>
      ))}
    </div>
  )
}

function PendingPage({ label }: { label: string }) {
  return (
    <div aria-busy className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <p aria-live="polite" className="sr-only">
        {label}
      </p>
      <div aria-hidden className="flex flex-col gap-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}

export function HomeScreen({ defaultWindow = '24h' }: { defaultWindow?: HomeWindow }) {
  const t = useTranslations()
  const [timeWindow, setTimeWindow] = useState<HomeWindow>(defaultWindow)
  const queryClient = useQueryClient()
  const router = useRouter()
  const liveStatus = useLiveStatus()

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(homeQuery(timeWindow))
  const firstSteps = useQuery(firstStepsQuery)
  const setup = firstSteps.data && firstStepsProgress(firstSteps.data)
  const redirectsToFirstSteps = setup?.hasTradingPartner === false

  useEffect(() => {
    if (redirectsToFirstSteps) {
      router.replace(navigationItems.firstSteps.href)
    }
  }, [redirectsToFirstSteps, router])

  const shownWindow = data?.window ?? timeWindow
  const fetchedAt = queryClient.getQueryState(homeKeys.window(shownWindow))?.dataUpdatedAt ?? 0
  const rows = data && toBucketRows(data.throughput, fetchedAt)
  const totals = rows && totalsOf(rows)
  const busy = isPending || isPlaceholderData

  if (firstSteps.isPending || redirectsToFirstSteps) {
    return <PendingPage label={t('Shell.workspace.loading')} />
  }

  function charts() {
    if (!rows || !totals) {
      return <LoadingCharts />
    }

    if (totals.finished === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={ChartLineData01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{t('Home.empty.title')}</EmptyTitle>
            <EmptyDescription>
              {t('Home.empty.description', { period: t(`Home.period.${shownWindow}`) })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    return (
      <>
        <div className="grid gap-4 lg:grid-cols-2">
          <ThroughputChart rows={rows} timeWindow={shownWindow} totals={totals} />
          <ErrorRateChart rows={rows} timeWindow={shownWindow} totals={totals} />
        </div>
        <BucketTable rows={rows} timeWindow={shownWindow} />
      </>
    )
  }

  return (
    <AppPage
      actions={<WindowSwitch value={timeWindow} onChange={setTimeWindow} />}
      busy={busy && !isError}
      meta={<LiveIndicator status={liveStatus} />}
      title={t('Sidebar.items.home.label')}>
      <p aria-live="polite" className="sr-only">
        {busy && !isError ? t('Home.loading') : ''}
      </p>
      {isError ? (
        <LoadError
          description={t('Home.error.description')}
          retryLabel={t('Home.error.retry')}
          title={t('Home.error.title')}
          onRetry={() => void refetch()}
        />
      ) : (
        <div
          className={cn(
            'flex flex-col gap-6',
            isPlaceholderData && 'opacity-60 transition-opacity',
          )}>
          {setup && setup.done < setup.total && (
            <HomeSetupLink done={setup.done} total={setup.total} />
          )}
          <HomeKeyNumbers
            failed={totals?.failed}
            keyNumbers={data?.keyNumbers}
            timeWindow={shownWindow}
          />
          <HomeDraftPromo />
          <div className="flex flex-col gap-4">{charts()}</div>
          <HomeTradingPartners tradingPartners={data?.tradingPartners} />
        </div>
      )}
    </AppPage>
  )
}
