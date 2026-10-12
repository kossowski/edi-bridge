'use client'

import { HierarchySquare02Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import {
  AddDocumentStructureCard,
  DocumentStructureCard,
} from '@/components/document-structures/document-structure-card'
import { ListEmpty, NewLink } from '@/components/list-table'
import { LoadError } from '@/components/load-error'
import { useCanChange } from '@/hooks/use-session'
import { documentStructuresQuery } from '@/lib/api/queries'
import { newDocumentStructureHref } from '@/lib/navigation'
import { Card, CardContent, CardHeader } from '@edi-bridge/ui/components/card'
import { Input } from '@edi-bridge/ui/components/input'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

function LoadingCards() {
  return Array.from({ length: 5 }, (_, index) => (
    <li key={index}>
      <Card className="h-full">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    </li>
  ))
}

function matches(summary: DocumentStructureSummary, term: string) {
  return [summary.name, ...summary.mappings.map(({ name }) => name)].some((text) =>
    text.toLocaleLowerCase().includes(term),
  )
}

export function DocumentStructuresScreen() {
  const t = useTranslations()
  const tList = useTranslations('DocumentStructures')
  const summaries = useQuery(documentStructuresQuery)
  const canChange = useCanChange()
  const searchId = useId()
  const [search, setSearch] = useState('')
  const title = t('Sidebar.items.dataFormats.label')

  function content() {
    if (summaries.isError) {
      return (
        <LoadError
          description={tList('error.description')}
          retryLabel={tList('error.retry')}
          title={tList('error.title')}
          onRetry={() => void summaries.refetch()}
        />
      )
    }

    if (summaries.data?.length === 0) {
      return (
        <ListEmpty
          action={<NewLink href={newDocumentStructureHref} label={tList('empty.action')} />}
          description={tList('empty.description')}
          icon={HierarchySquare02Icon}
          title={tList('empty.title')}
          viewOnlyDescription={tList('empty.viewOnlyDescription')}
        />
      )
    }

    const busy = summaries.isPending
    const all = summaries.data ?? []
    const term = search.trim().toLocaleLowerCase()
    const shown = term === '' ? all : all.filter((summary) => matches(summary, term))

    return (
      <div className="@container flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-72">
            <label htmlFor={searchId} className="text-sm font-medium">
              {tList('search')}
            </label>
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {busy
              ? tList('loading')
              : term === ''
                ? tList('count', { count: shown.length })
                : tList('filteredCount', { count: shown.length, total: all.length })}
          </p>
        </div>
        <ul
          aria-busy={busy}
          aria-label={title}
          className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
          {canChange && term === '' && (
            <li>
              <AddDocumentStructureCard />
            </li>
          )}
          {busy ? (
            <LoadingCards />
          ) : (
            shown.map((summary) => (
              <li key={summary.id}>
                <DocumentStructureCard summary={summary} />
              </li>
            ))
          )}
        </ul>
        {!busy && shown.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">{tList('noMatch')}</p>
        )}
      </div>
    )
  }

  return (
    <AppPage title={title} className="gap-4">
      {content()}
    </AppPage>
  )
}
