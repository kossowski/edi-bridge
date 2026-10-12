'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@edi-bridge/ui/lib/utils'

export function PartnerGln({
  gln,
  label,
  className,
}: {
  gln: string | null
  label?: 'prefix' | 'outside'
  className?: string
}) {
  const t = useTranslations('TradingPartner')

  if (gln === null) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        {label === 'outside' ? t('glnMissingAfterLabel') : t('glnMissing')}
      </span>
    )
  }

  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {label === 'prefix' ? t('gln', { gln }) : gln}
    </span>
  )
}
