'use client'

import { useTranslations } from 'next-intl'

import { AppBreadcrumb } from '@/components/app-breadcrumb'
import { headerTabsId } from '@/components/header-tabs'
import { ViewOnlyBadge } from '@/components/session/view-only-badge'
import { SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function AppHeader() {
  const t = useTranslations('Shell')

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-10 shrink-0 border-b backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        <SidebarTrigger label={t('toggleSidebar')} />
        <AppBreadcrumb />
        <ViewOnlyBadge />
      </div>
      <div id={headerTabsId} className="bg-muted/60 border-t px-4 py-1.5 empty:hidden" />
    </header>
  )
}
