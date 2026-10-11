'use client'

import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { CompanyIdentitySection } from '@/components/settings/company-identity-form'
import { RetentionAndBudgetSection } from '@/components/settings/retention-and-budget-form'
import { Separator } from '@edi-bridge/ui/components/separator'

export function SettingsScreen() {
  const t = useTranslations('Navigation')

  return (
    <AppPage title={t('settings')} className="gap-6">
      <CompanyIdentitySection />
      <Separator />
      <RetentionAndBudgetSection />
    </AppPage>
  )
}
