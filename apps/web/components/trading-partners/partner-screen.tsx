'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Suspense, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { LoadFailure } from '@/components/detail-parts'
import { HeaderTabs } from '@/components/header-tabs'
import { PartnerConnections } from '@/components/trading-partners/partner-connections-panel'
import { PartnerDocuments } from '@/components/trading-partners/partner-documents-panel'
import { PartnerGln } from '@/components/trading-partners/partner-gln'
import { PartnerLoading, PartnerOverview } from '@/components/trading-partners/partner-overview'
import { PartnerSettings } from '@/components/trading-partners/partner-settings'
import { SetupNotice } from '@/components/trading-partners/partner-setup-notice'
import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { useUrlTab } from '@/hooks/use-url-tab'
import { ApiError } from '@/lib/api/client'
import { tradingPartnerQuery, useTakenSetupSummary } from '@/lib/api/queries'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import type { TradingPartner } from '@edi-bridge/contracts'

const partnerTabs = [
  { value: 'overview' },
  { value: 'documents' },
  { value: 'connections' },
  { value: 'settings' },
] as const

type PartnerTab = (typeof partnerTabs)[number]['value']

function PartnerTabs({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.tabs')
  const [tab, changeTab] = useUrlTab(partnerTabs, 'overview')
  const [addingConnection, setAddingConnection] = useState(false)
  const [addingDocument, setAddingDocument] = useState(false)

  function addConnection() {
    setAddingDocument(false)
    changeTab('connections')
    setAddingConnection(true)
  }

  function addDocument() {
    changeTab('documents')
    setAddingDocument(true)
  }

  function panel(value: PartnerTab) {
    switch (value) {
      case 'overview':
        return (
          <PartnerOverview
            tradingPartner={tradingPartner}
            onAddConnection={addConnection}
            onAddDocument={addDocument}
          />
        )
      case 'documents':
        return (
          <PartnerDocuments
            addingDocument={addingDocument}
            tradingPartner={tradingPartner}
            onAddConnection={addConnection}
            onAddingDocumentChange={setAddingDocument}
          />
        )
      case 'connections':
        return (
          <PartnerConnections
            addingConnection={addingConnection}
            tradingPartner={tradingPartner}
            onAddingConnectionChange={setAddingConnection}
          />
        )
      case 'settings':
        return <PartnerSettings tradingPartner={tradingPartner} />
    }
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
      {partnerTabs.map(({ value }) => (
        <TabsContent key={value} value={value} className="flex flex-col gap-4">
          {panel(value)}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export function PartnerScreen({ id }: { id: string }) {
  const t = useTranslations('TradingPartner')
  const [setupSummary, dismissSetupSummary] = useTakenSetupSummary(id)
  const titleRef = useRef<HTMLHeadingElement>(null)

  function dismissSetupNotice() {
    flushSync(dismissSetupSummary)
    titleRef.current?.focus()
  }

  const { data, error, isPending, refetch } = useQuery(tradingPartnerQuery(id))

  return (
    <AppPage
      meta={
        data && (
          <>
            <TestModeBadge testMode={data.testMode} />
            <PartnerGln gln={data.gln} label="prefix" />
          </>
        )
      }
      name={data?.name}
      titleRef={titleRef}>
      {isPending ? (
        <PartnerLoading label={t('loading')} />
      ) : data ? (
        <>
          {setupSummary && <SetupNotice summary={setupSummary} onDismiss={dismissSetupNotice} />}
          <Suspense>
            <PartnerTabs tradingPartner={data} />
          </Suspense>
        </>
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
