'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BudgetUsage } from '@/components/settings/budget-usage'
import { SettingsCard, SettingsTabContent } from '@/components/settings/settings-card'
import { workspaceSettingsQuery } from '@/lib/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'

import type { AiTokenBudget } from '@edi-bridge/contracts'

function Retention({ days }: { days: number }) {
  const t = useTranslations('Settings.data.retention')

  return (
    <SettingsCard title={t('title')}>
      <p>{t.rich('deleted', { days, strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p className="text-muted-foreground">{t('reprocess')}</p>
    </SettingsCard>
  )
}

function AiBudget({ budget }: { budget: AiTokenBudget }) {
  const t = useTranslations('Settings.data.budget')

  return (
    <SettingsCard description={t('description')} title={t('title')}>
      <BudgetUsage budget={budget} />
    </SettingsCard>
  )
}

export function DataTab() {
  const t = useTranslations('Settings.data')
  const query = useQuery(workspaceSettingsQuery)

  return (
    <SettingsTabContent query={query}>
      {(settings) => (
        <>
          <Alert role={undefined}>
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
            <AlertTitle>{t('setByOperator.title')}</AlertTitle>
            <AlertDescription>{t('setByOperator.description')}</AlertDescription>
          </Alert>
          <Retention days={settings.documentRetentionDays} />
          <AiBudget budget={settings.aiTokenBudget} />
        </>
      )}
    </SettingsTabContent>
  )
}
