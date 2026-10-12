'use client'

import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { LoadFailure } from '@/components/detail-parts'
import { BudgetUsage } from '@/components/settings/budget-usage'
import { SettingsCard, SettingsTabLoading } from '@/components/settings/settings-card'
import { useSession } from '@/hooks/use-session'
import { workspaceSettingsQuery } from '@/lib/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'

import type { WorkspaceSettings } from '@edi-bridge/contracts'

function Retention({ days }: { days: number }) {
  const t = useTranslations('Settings.data.retention')

  return (
    <SettingsCard title={t('title')}>
      <p>{t.rich('deleted', { days, strong: (chunks) => <strong>{chunks}</strong> })}</p>
      <p className="text-muted-foreground">{t('reprocess')}</p>
    </SettingsCard>
  )
}

function AiBudget({ settings }: { settings: WorkspaceSettings }) {
  const t = useTranslations('Settings.data.budget')
  const { dailyLimit } = settings.aiTokenBudget

  return (
    <SettingsCard description={t('description')} title={t('title')}>
      {dailyLimit > 0 && (
        <p>
          {t.rich('limit', {
            limit: dailyLimit,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      )}
      <BudgetUsage budget={settings.aiTokenBudget} />
    </SettingsCard>
  )
}

export function DataTab() {
  const t = useTranslations('Settings.data')
  const session = useSession()
  const query = useQuery(workspaceSettingsQuery)

  if (session.isPending || query.isPending) {
    return <SettingsTabLoading />
  }

  if (query.isError) {
    return (
      <LoadFailure namespace="Settings" notFound={false} onRetry={() => void query.refetch()} />
    )
  }

  const { data } = query

  return (
    <>
      <Alert role={undefined}>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
        <AlertTitle>{t('setByOperator.title')}</AlertTitle>
        <AlertDescription>{t('setByOperator.description')}</AlertDescription>
      </Alert>
      <Retention days={data.documentRetentionDays} />
      <AiBudget settings={data} />
    </>
  )
}
