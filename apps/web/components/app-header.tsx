'use client'

import { useTranslations } from 'next-intl'

import { ViewOnlyBadge } from '@/components/session/view-only-badge'
import { SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function AppHeader() {
  const t = useTranslations('Shell')

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger label={t('toggleSidebar')} />
      <ViewOnlyBadge />
    </header>
  )
}
