'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { SettingsCard } from '@/components/settings/settings-card'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'
import { useSession } from '@/hooks/use-session'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { TradingPartner } from '@edi-bridge/contracts'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  )
}

function PartnerDetails({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartnerForm')
  const tList = useTranslations('TradingPartners')

  return (
    <dl className="flex flex-col gap-4">
      <Detail label={t('fields.name.label')}>{tradingPartner.name}</Detail>
      <Detail label={t('fields.gln.label')}>
        <span className="font-mono tabular-nums">{tradingPartner.gln}</span>
      </Detail>
      <Detail label={t('fields.characterSet.label')}>
        {t(`characterSets.${tradingPartner.characterSet}`)}
      </Detail>
      <Detail label={t('fields.acknowledgementTimeLimitHours.label')}>
        {tList('hours', { hours: tradingPartner.acknowledgementTimeLimitHours })}
      </Detail>
    </dl>
  )
}

export function PartnerSettings({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.settings')
  const session = useSession()

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <SettingsCard
        description={t('description', { name: tradingPartner.name })}
        title={t('title')}>
        {session.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : session.canChange ? (
          <TradingPartnerForm savedLabel={t('saved')} tradingPartner={tradingPartner} />
        ) : (
          <PartnerDetails tradingPartner={tradingPartner} />
        )}
      </SettingsCard>
    </div>
  )
}
