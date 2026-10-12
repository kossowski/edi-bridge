'use client'

import { HierarchySquare02Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AppPage } from '@/components/app-page'
import {
  AddDocumentStructureCard,
  DocumentStructureCard,
} from '@/components/document-structures/document-structure-card'
import { ListNoMatch, ListStates, ListToolbar, NewLink } from '@/components/list-table'
import { useCanChange } from '@/hooks/use-session'
import { documentStructuresQuery } from '@/lib/api/queries'
import { newDocumentStructureHref } from '@/lib/navigation'
import { Card, CardContent, CardHeader } from '@edi-bridge/ui/components/card'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

function LoadingCards() {
  return Array.from({ length: 5 }, (_, index) => (
    <li key={index} className="min-w-0">
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
  const [search, setSearch] = useState('')
  const title = t('Sidebar.items.dataFormats.label')

  const busy = summaries.isPending
  const all = summaries.data ?? []
  const term = search.trim().toLocaleLowerCase()
  const shown = term === '' ? all : all.filter((summary) => matches(summary, term))

  return (
    <AppPage title={title} className="gap-4">
      <ListStates
        emptyAction={<NewLink href={newDocumentStructureHref} label={tList('empty.action')} />}
        emptyIcon={HierarchySquare02Icon}
        query={summaries}
        t={tList}>
        <div className="@container flex flex-col gap-3">
          <ListToolbar
            busy={busy}
            count={shown.length}
            filtered={term !== ''}
            search={search}
            t={tList}
            total={all.length}
            onSearchChange={setSearch}
          />
          <ul
            aria-busy={busy}
            aria-label={title}
            className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {canChange && term === '' && (
              <li className="min-w-0">
                <AddDocumentStructureCard />
              </li>
            )}
            {busy ? (
              <LoadingCards />
            ) : (
              shown.map((summary) => (
                <li key={summary.id} className="min-w-0">
                  <DocumentStructureCard summary={summary} />
                </li>
              ))
            )}
          </ul>
          {!busy && shown.length === 0 && <ListNoMatch t={tList} className="text-sm" />}
        </div>
      </ListStates>
    </AppPage>
  )
}
