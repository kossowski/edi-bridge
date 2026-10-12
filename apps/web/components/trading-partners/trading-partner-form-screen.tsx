'use client'

import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'

export function NewTradingPartnerScreen() {
  const t = useTranslations()

  return (
    <AppPage title={t('TradingPartnerForm.createTitle')}>
      <TradingPartnerForm />
    </AppPage>
  )
}
