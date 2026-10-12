'use client'

import { useTranslations } from 'next-intl'
import { Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export function SettingsScreen() {
  const t = useTranslations('Shell.session')

  return (
    <AppPage title={t('settings')}>
      <Suspense>
        <SettingsTabs />
      </Suspense>
    </AppPage>
  )
}
