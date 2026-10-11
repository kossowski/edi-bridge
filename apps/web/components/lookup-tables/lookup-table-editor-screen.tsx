'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { LoadFailure } from '@/components/detail-parts'
import { LookupTableEntryEditor } from '@/components/lookup-tables/lookup-table-entry-editor'
import { ScopeLabel } from '@/components/lookup-tables/lookup-table-scope-label'
import { useSession } from '@/hooks/use-session'
import { ApiError } from '@/lib/api/client'
import { lookupTableQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

function focusIfNothingFocused(heading: HTMLHeadingElement | null) {
  if (heading && (document.activeElement === null || document.activeElement === document.body)) {
    heading.focus()
  }
}

export function LookupTableEditorScreen({ id }: { id: string }) {
  const t = useTranslations('LookupTable')
  const tLookupTables = useTranslations('LookupTables')
  const { data, error, isPending, refetch } = useQuery(lookupTableQuery(id))
  const session = useSession()

  return (
    <AppPage
      meta={
        data && (
          <dl className="flex flex-wrap gap-x-2">
            <dt>{tLookupTables('columns.scope')}:</dt>
            <dd>
              <ScopeLabel scope={data.scope} />
            </dd>
          </dl>
        )
      }
      name={data?.name}
      titleRef={data && !session.isPending ? focusIfNothingFocused : undefined}>
      {isPending || session.isPending ? (
        <div aria-busy className="flex flex-col gap-6">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data ? (
        <LookupTableEntryEditor key={data.id} canChange={session.canChange} table={data} />
      ) : (
        <LoadFailure
          namespace="LookupTable"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
