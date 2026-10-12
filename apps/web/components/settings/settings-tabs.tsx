'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { HeaderTabs } from '@/components/header-tabs'
import { CompanyTab } from '@/components/settings/company-tab'
import { DataTab } from '@/components/settings/data-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

const settingsTabs = ['company', 'data'] as const

type SettingsTab = (typeof settingsTabs)[number]

function settingsTabOf(value: string | null): SettingsTab {
  return settingsTabs.find((tab) => tab === value) ?? 'company'
}

export function SettingsTabs() {
  const t = useTranslations('Settings.tabs')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = settingsTabOf(searchParams.get('tab'))

  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', settingsTabOf(value))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <HeaderTabs>
        <TabsList variant="line">
          <TabsTrigger value="company">{t('company')}</TabsTrigger>
          <TabsTrigger value="data">{t('data')}</TabsTrigger>
        </TabsList>
      </HeaderTabs>
      <TabsContent value="company" className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <CompanyTab />
      </TabsContent>
      <TabsContent value="data" className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <DataTab />
      </TabsContent>
    </Tabs>
  )
}
