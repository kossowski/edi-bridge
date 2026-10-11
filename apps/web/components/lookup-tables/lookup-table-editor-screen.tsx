'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BackLink, LoadFailure } from '@/components/detail-parts'
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
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/lookup-tables" label={t('back')} />
      {isPending || session.isPending ? (
        <div aria-busy className="flex flex-col gap-6">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data ? (
        <>
          <div className="flex flex-col gap-1">
            <h1
              ref={focusIfNothingFocused}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none">
              {data.name}
            </h1>
            <dl className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
              <dt>{tLookupTables('columns.scope')}:</dt>
              <dd>
                <ScopeLabel scope={data.scope} />
              </dd>
            </dl>
          </div>
          <LookupTableEntryEditor key={data.id} canChange={session.canChange} table={data} />
        </>
      ) : (
        <LoadFailure
          namespace="LookupTable"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
