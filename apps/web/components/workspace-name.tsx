'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { currentWorkspaceQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function WorkspaceName() {
  const t = useTranslations('Shell.workspace')
  const { data: workspace, isError, isPending } = useQuery(currentWorkspaceQuery)

  if (isPending) {
    return (
      <Skeleton className="h-4 w-32">
        <span className="sr-only">{t('loading')}</span>
      </Skeleton>
    )
  }

  if (isError) {
    return <p className="text-muted-foreground truncate text-sm">{t('unavailable')}</p>
  }

  return (
    <p className="truncate text-sm font-medium">
      <span className="sr-only">{t('label')}: </span>
      {workspace.name}
    </p>
  )
}
