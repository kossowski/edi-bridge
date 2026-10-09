'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BackLink, LoadFailure } from '@/components/detail-parts'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'
import { ApiError } from '@/lib/api/client'
import { tradingPartnerQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

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
  const t = useTranslations()
  const { data, error, isPending, refetch } = useQuery(tradingPartnerQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink
        href={data ? `/trading-partners/${id}` : '/trading-partners'}
        label={
          data ? t('TradingPartnerForm.backTo', { name: data.name }) : t('TradingPartner.back')
        }
      />
      {isPending ? (
        <div aria-busy className="flex max-w-xl flex-col gap-6">
          <p role="status" className="sr-only">
            {t('TradingPartner.loading')}
          </p>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('TradingPartnerForm.editTitle', { name: data.name })}
          </h1>
          <TradingPartnerForm tradingPartner={data} />
        </>
      ) : (
        <LoadFailure
          namespace="TradingPartner"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
