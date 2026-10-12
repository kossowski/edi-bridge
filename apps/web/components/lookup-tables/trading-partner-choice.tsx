'use client'

import { useTranslations } from 'next-intl'

import { SelectField } from '@/components/form-field'
import { useLookup } from '@/hooks/use-lookup'
import { tradingPartnersQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'

export function TradingPartnerChoice({
  id,
  value,
  error,
  onChange,
}: {
  id: string
  value: string | null
  error: string | null
  onChange: (tradingPartnerId: string) => void
}) {
  const t = useTranslations('LookupTables.form.fields.tradingPartner')
  const tradingPartners = useLookup(tradingPartnersQuery)

  if (tradingPartners.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('error')}
        </p>
        <Button size="sm" variant="outline" onClick={() => void tradingPartners.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (tradingPartners.data?.length === 0) {
    return <p className="text-muted-foreground rounded-lg border p-3 text-sm">{t('empty')}</p>
  }

  return (
    <SelectField
      id={id}
      description={t('description')}
      error={error}
      items={(tradingPartners.data ?? []).map((tradingPartner) => ({
        value: tradingPartner.id,
        label: tradingPartner.name,
      }))}
      label={t('label')}
      loading={tradingPartners.isPending}
      placeholder={tradingPartners.isPending ? t('loading') : t('placeholder')}
      value={value}
      className="w-full"
      onChange={onChange}
    />
  )
}
