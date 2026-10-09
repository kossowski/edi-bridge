'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BackLink } from '@/components/detail-parts'
import { EditScreen } from '@/components/edit-screen'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'
import { tradingPartnerQuery } from '@/lib/api/queries'

export function NewTradingPartnerScreen() {
  const t = useTranslations()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/trading-partners" label={t('TradingPartner.back')} />
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('TradingPartnerForm.createTitle')}
      </h1>
      <TradingPartnerForm />
    </div>
  )
}

export function EditTradingPartnerScreen({ id }: { id: string }) {
  const query = useQuery(tradingPartnerQuery(id))

  return (
    <EditScreen
      detailHref={`/trading-partners/${id}`}
      listHref="/trading-partners"
      namespace="TradingPartner"
      query={query}
      width="max-w-xl">
      {(tradingPartner) => <TradingPartnerForm tradingPartner={tradingPartner} />}
    </EditScreen>
  )
}
