import { HugeiconsIcon } from '@hugeicons/react'
import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { type NavigationKey, navigationItems } from '@/lib/navigation'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'

export function placeholderMetadata(page: NavigationKey) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations()

    // The layout's title template skips pages in its own segment, so the root page would lose the suffix.
    return { title: { absolute: `${t(`Navigation.${page}`)} · ${t('Shell.appName')}` } }
  }
}

export async function PagePlaceholder({ page }: { page: NavigationKey }) {
  const t = await getTranslations()

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t(`Navigation.${page}`)}</h1>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={navigationItems[page].icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('Placeholder.title')}</EmptyTitle>
          <EmptyDescription>{t(`Placeholder.${page}`)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
