'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ComponentType, Suspense, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadFailure } from '@/components/detail-parts'
import { HeaderTabs } from '@/components/header-tabs'
import { PartnerConnections } from '@/components/trading-partners/partner-connections-panel'
import { PartnerLoading, PartnerOverview } from '@/components/trading-partners/partner-overview'
import {
  awaitsReceiptConfirmation,
  type PartnerPanelProps,
} from '@/components/trading-partners/partner-page-helpers'
import { PartnerSettings } from '@/components/trading-partners/partner-settings'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { useUrlTab } from '@/hooks/use-url-tab'
import { ApiError } from '@/lib/api/client'
import { tradingPartnerQuery } from '@/lib/api/queries'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import type { TradingPartner } from '@edi-bridge/contracts'

export const receiptConfirmationPollMs = 3000

const partnerTabs: readonly {
  value: 'overview' | 'connections' | 'settings'
  Panel: ComponentType<PartnerPanelProps>
}[] = [
  { value: 'overview', Panel: PartnerOverview },
  { value: 'connections', Panel: PartnerConnections },
  { value: 'settings', Panel: PartnerSettings },
]

function PartnerTabs({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.tabs')
  const [tab, changeTab] = useUrlTab(partnerTabs, 'overview')
  const [addingConnection, setAddingConnection] = useState(false)

  function addConnection() {
    changeTab('connections')
    setAddingConnection(true)
  }

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <HeaderTabs>
        <TabsList variant="line" aria-label={t('label')}>
          {partnerTabs.map(({ value }) => (
            <TabsTrigger key={value} value={value}>
              {t(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </HeaderTabs>
      {partnerTabs.map(({ value, Panel }) => (
        <TabsContent key={value} value={value} className="flex flex-col gap-4">
          <Panel
            addingConnection={addingConnection}
            tradingPartner={tradingPartner}
            onAddConnection={addConnection}
            onAddingConnectionChange={setAddingConnection}
          />
        </TabsContent>
      ))}
    </Tabs>
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
        <PartnerLoading label={t('loading')} />
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
