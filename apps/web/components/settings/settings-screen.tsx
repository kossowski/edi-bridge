'use client'

import { useTranslations } from 'next-intl'

import { CompanyIdentitySection } from '@/components/settings/company-identity-form'

export function SettingsScreen() {
  const t = useTranslations('Navigation')

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings')}</h1>
      <CompanyIdentitySection />
    </div>
  )
}
