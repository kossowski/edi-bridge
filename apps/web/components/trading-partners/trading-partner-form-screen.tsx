'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { EditScreen } from '@/components/edit-screen'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'
import { tradingPartnerQuery } from '@/lib/api/queries'

export function NewTradingPartnerScreen() {
  const t = useTranslations()

  return (
    <AppPage title={t('TradingPartnerForm.createTitle')}>
      <TradingPartnerForm />
    </AppPage>
  )
}

export function EditTradingPartnerScreen({ id }: { id: string }) {
  const query = useQuery(tradingPartnerQuery(id))

  return (
    <EditScreen namespace="TradingPartner" query={query} width="max-w-xl">
      {(tradingPartner) => <TradingPartnerForm tradingPartner={tradingPartner} />}
    </EditScreen>
  )
}
