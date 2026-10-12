'use client'

import { useTranslations } from 'next-intl'

import { HeaderTabs } from '@/components/header-tabs'
import { CompanyTab } from '@/components/settings/company-tab'
import { DataTab } from '@/components/settings/data-tab'
import { MembersTab } from '@/components/settings/members-tab'
import { useUrlTab } from '@/hooks/use-url-tab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

const settingsTabs = [
  { value: 'company', Panel: CompanyTab },
  { value: 'members', Panel: MembersTab },
  { value: 'data', Panel: DataTab },
] as const

export function SettingsTabs() {
  const t = useTranslations('Settings.tabs')
  const [tab, changeTab] = useUrlTab(settingsTabs, 'company')

  return (
    <Tabs value={tab} onValueChange={changeTab}>
      <HeaderTabs>
        <TabsList variant="line">
          {settingsTabs.map(({ value }) => (
            <TabsTrigger key={value} value={value}>
              {t(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </HeaderTabs>
      {settingsTabs.map(({ value, Panel }) => (
        <TabsContent
          key={value}
          value={value}
          className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <Panel />
        </TabsContent>
      ))}
    </Tabs>
  )
}
