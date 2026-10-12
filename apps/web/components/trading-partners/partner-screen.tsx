'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type ComponentType, Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadFailure } from '@/components/detail-parts'
import { HeaderTabs } from '@/components/header-tabs'
import { PartnerOverview } from '@/components/trading-partners/partner-overview'
import {
  awaitsReceiptConfirmation,
  type PartnerTab,
  partnerTabOf,
  partnerTabs,
} from '@/components/trading-partners/partner-page-helpers'
import { PartnerSettings } from '@/components/trading-partners/partner-settings'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { ApiError } from '@/lib/api/client'
import { tradingPartnerQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import type { TradingPartner } from '@edi-bridge/contracts'

export const receiptConfirmationPollMs = 3000

const panels: Record<PartnerTab, ComponentType<{ tradingPartner: TradingPartner }>> = {
  overview: PartnerOverview,
  settings: PartnerSettings,
}

function PartnerTabs({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.tabs')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = partnerTabOf(searchParams.get('tab'))

  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', partnerTabOf(value))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <HeaderTabs>
        <TabsList variant="line" aria-label={t('label')}>
          {partnerTabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </HeaderTabs>
      {partnerTabs.map((value) => {
        const Panel = panels[value]

        return (
          <TabsContent key={value} value={value} className="flex flex-col gap-4">
            <Panel tradingPartner={tradingPartner} />
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

function PartnerLoading() {
  const t = useTranslations('TradingPartner')

  return (
    <div aria-busy className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  )
}

export function PartnerScreen({ id }: { id: string }) {
  const t = useTranslations('TradingPartner')

  const { data, error, isPending, refetch } = useQuery({
    ...tradingPartnerQuery(id),
    refetchInterval: ({ state }) =>
      state.data && awaitsReceiptConfirmation(state.data) ? receiptConfirmationPollMs : false,
  })

  return (
    <AppPage
      meta={
        data && (
          <>
            <TestModeBadge testMode={data.testMode} />
            <span className="font-mono tabular-nums">{t('gln', { gln: data.gln })}</span>
          </>
        )
      }
      name={data?.name}>
      {isPending ? (
        <PartnerLoading />
      ) : data ? (
        <Suspense>
          <PartnerTabs tradingPartner={data} />
        </Suspense>
      ) : (
        <LoadFailure
          namespace="TradingPartner"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
