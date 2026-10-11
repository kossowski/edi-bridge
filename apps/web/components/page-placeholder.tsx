import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { type NavigationKey } from '@/lib/navigation'

export function placeholderMetadata(page: NavigationKey) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations()

    // The layout's title template skips pages in its own segment, so the root page would lose the suffix.
    return { title: { absolute: `${t(`Navigation.${page}`)} · ${t('Shell.appName')}` } }
  }
}
