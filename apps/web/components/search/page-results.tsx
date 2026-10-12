import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import type { IconSvgElement } from '@hugeicons/react'

import { CommandItemHint } from '@/components/search/command-item-hint'
import { accountMenuItems, sidebarItems } from '@/lib/navigation'
import { CommandGroup, CommandItem } from '@edi-bridge/ui/components/command'

type Page = { key: string; href: string; icon: IconSvgElement; label: string; hint?: string }

export function PageResults({
  operator,
  onOpen,
}: {
  operator: boolean
  onOpen: (href: string) => void
}) {
  const t = useTranslations()

  const pages: ReadonlyArray<Page> = [
    ...sidebarItems.map((item) => ({
      ...item,
      label: t(`Sidebar.items.${item.key}.label`),
      hint: t(`Sidebar.items.${item.key}.hint`),
    })),
    ...accountMenuItems(operator).map((item) => ({
      ...item,
      label: t(`Shell.session.${item.key}`),
    })),
  ]

  return (
    <CommandGroup heading={t('Search.groups.pages')}>
      {pages.map((page) => (
        <CommandItem
          key={page.key}
          keywords={page.hint ? [page.label, page.hint] : [page.label]}
          value={`page ${page.key}`}
          onSelect={() => onOpen(page.href)}>
          <HugeiconsIcon icon={page.icon} strokeWidth={2} aria-hidden />
          <span className="max-w-full shrink-0 truncate">{page.label}</span>
          {page.hint && (
            <CommandItemHint className="hidden min-w-0 shrink truncate sm:inline">
              {page.hint}
            </CommandItemHint>
          )}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
