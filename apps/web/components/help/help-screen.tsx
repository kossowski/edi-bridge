'use client'

import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { useGlossary } from '@/hooks/use-glossary'
import { glossaryEntries } from '@/lib/glossary'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'

export function HelpScreen() {
  const t = useTranslations()
  const locale = useLocale()
  const glossary = useGlossary()
  const searchId = useId()
  const [search, setSearch] = useState('')

  const collator = new Intl.Collator(locale)

  const entries = glossaryEntries
    .map((entry) => ({ id: entry.id, term: entry.term, ...glossary(entry) }))
    .toSorted((a, b) => collator.compare(a.label, b.label))

  const query = search.trim().toLocaleLowerCase(locale)

  const shown =
    query === ''
      ? entries
      : entries.filter((entry) =>
          [entry.label, entry.term, entry.explanation].some((text) =>
            text.toLocaleLowerCase(locale).includes(query),
          ),
        )

  return (
    <AppPage title={t('Sidebar.items.help.label')}>
      <p className="text-muted-foreground max-w-prose text-sm">{t('Help.intro')}</p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            <label htmlFor={searchId} className="text-sm font-medium">
              {t('Help.search')}
            </label>
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {query === ''
              ? t('Help.count', { count: shown.length })
              : t('Help.filteredCount', { count: shown.length, total: entries.length })}
          </p>
        </div>
        {shown.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>{t('Help.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('Help.empty.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((entry) => (
              <div
                key={entry.id}
                id={entry.id}
                className="bg-card target:border-primary target:ring-ring/50 flex scroll-mt-24 flex-col gap-1.5 rounded-xl border p-4 text-sm target:ring-[3px]">
                <dt className="font-medium">{entry.label}</dt>
                <dd className="text-muted-foreground text-xs">
                  {t('Help.technicalTerm')}: <span lang="en">{entry.term}</span>
                </dd>
                <dd>{entry.explanation}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </AppPage>
  )
}
