'use client'

import { useTranslations } from 'next-intl'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { UserMenu, ViewOnlyBadge } from '@/components/session/user-menu'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { WorkspaceName } from '@/components/workspace-name'
import { SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function AppHeader() {
  const t = useTranslations('Shell')

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger label={t('toggleSidebar')} />
      <div className="flex min-w-0 items-center gap-2">
        <WorkspaceName />
        <ViewOnlyBadge />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeSwitcher />
        <UserMenu />
      </div>
    </header>
  )
}
