import { getTranslations } from 'next-intl/server'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { WorkspaceName } from '@/components/workspace-name'
import { SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export async function AppHeader() {
  const t = await getTranslations('Shell')

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger label={t('toggleSidebar')} />
      <div className="min-w-0">
        <WorkspaceName />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeSwitcher />
      </div>
    </header>
  )
}
