import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { type PageItemKey, pageItems, type SidebarItemKey } from '@/lib/navigation'

function isPageItemKey(page: string): page is PageItemKey {
  return pageItems.some(({ key }) => key === page)
}

export function pageMetadata(page: SidebarItemKey | PageItemKey | 'settings' | 'operatorArea') {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations()

    const label =
      page === 'settings' || page === 'operatorArea'
        ? t(`Shell.session.${page}`)
        : isPageItemKey(page)
          ? t(`Pages.${page}.label`)
          : t(`Sidebar.items.${page}.label`)

    // The layout's title template skips pages in its own segment, so the root page would lose the suffix.
    return { title: { absolute: `${label} · ${t('Shell.appName')}` } }
  }
}
