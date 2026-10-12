'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { Failure } from '@/components/detail-parts'
import { WorkspaceKindBadge } from '@/components/operator/workspace-kind-badge'
import { WorkspaceTabs } from '@/components/operator/workspace-tabs'
import { operatorWorkspacesQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

function WorkspaceLoading() {
  const t = useTranslations('Operator.workspace')

  return (
    <div aria-busy className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  )
}

export function WorkspaceDetailScreen({ id }: { id: string }) {
  const t = useTranslations('Operator.workspace')

  const { data, isPending, isError, refetch } = useQuery({
    ...operatorWorkspacesQuery,
    select: (workspaces) => workspaces.find((workspace) => workspace.id === id) ?? null,
  })

  return (
    <AppPage meta={data && <WorkspaceKindBadge kind={data.kind} />} name={data?.name}>
      {isPending ? (
        <WorkspaceLoading />
      ) : data ? (
        <Suspense>
          <WorkspaceTabs key={data.id} workspace={data} />
        </Suspense>
      ) : (
        <Failure
          error={{
            title: t('error.title'),
            description: t('error.description'),
            retry: t('error.retry'),
          }}
          notFound={
            isError ? null : { title: t('notFound.title'), description: t('notFound.description') }
          }
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
