'use client'

import { useTranslations } from 'next-intl'

import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadFailure } from '@/components/detail-parts'
import { ApiError } from '@/lib/api/client'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function EditScreen<Item extends { name: string }>({
  query,
  namespace,
  width = 'max-w-2xl',
  busy = false,
  children,
}: {
  query: UseQueryResult<Item>
  namespace: 'Channel' | 'Flow' | 'TradingPartner'
  width?: 'max-w-xl' | 'max-w-2xl'
  busy?: boolean
  children: (item: Item) => ReactNode
}) {
  const t = useTranslations()
  const { data, error, isPending, refetch } = query

  return (
    <AppPage
      busy={busy}
      name={data?.name}
      title={data ? t(`${namespace}Form.editTitle`, { name: data.name }) : t('Breadcrumb.edit')}>
      {isPending ? (
        <div aria-busy className={`flex ${width} flex-col gap-6`}>
          <p role="status" className="sr-only">
            {t(`${namespace}.loading`)}
          </p>
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data ? (
        children(data)
      ) : (
        <LoadFailure
          namespace={namespace}
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
