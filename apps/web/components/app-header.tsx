import { getTranslations } from 'next-intl/server'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export async function AppHeader() {
  const t = await getTranslations('Shell')

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger label={t('toggleSidebar')} title={t('toggleSidebar')} />
      <div className="ml-auto flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeSwitcher />
      </div>
    </header>
  )
}
