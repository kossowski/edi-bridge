'use client'

import { useTranslations } from 'next-intl'

import { Fact } from '@/components/detail-parts'
import { SettingsCard } from '@/components/settings/settings-card'
import { TradingPartnerForm } from '@/components/trading-partners/trading-partner-form'
import { useSession } from '@/hooks/use-session'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { TradingPartner } from '@edi-bridge/contracts'

function PartnerDetails({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartnerForm')
  const tList = useTranslations('TradingPartners')

  return (
    <dl className="flex flex-col gap-4">
      <Fact label={t('fields.name.label')}>{tradingPartner.name}</Fact>
      <Fact label={t('fields.gln.label')}>
        <span className="font-mono tabular-nums">{tradingPartner.gln}</span>
      </Fact>
      <Fact label={t('fields.characterSet.label')}>
        {t(`characterSets.${tradingPartner.characterSet}`)}
      </Fact>
      <Fact label={t('fields.acknowledgementTimeLimitHours.label')}>
        {tList('hours', { hours: tradingPartner.acknowledgementTimeLimitHours })}
      </Fact>
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
