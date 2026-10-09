'use client'

import { useTranslations } from 'next-intl'

import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { BackLink, LoadFailure } from '@/components/detail-parts'
import { ApiError } from '@/lib/api/client'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function EditScreen<Item extends { name: string }>({
  query,
  namespace,
  listHref,
  detailHref,
  width = 'max-w-2xl',
  busy = false,
  children,
}: {
  query: UseQueryResult<Item>
  namespace: 'Channel' | 'Flow' | 'TradingPartner'
  listHref: string
  detailHref: string
  width?: 'max-w-xl' | 'max-w-2xl'
  busy?: boolean
  children: (item: Item) => ReactNode
}) {
  const t = useTranslations()
  const { data, error, isPending, refetch } = query

  return (
    <div aria-busy={busy || undefined} className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink
        href={data ? detailHref : listHref}
        label={data ? t(`${namespace}Form.backTo`, { name: data.name }) : t(`${namespace}.back`)}
      />
      {isPending ? (
        <div aria-busy className={`flex ${width} flex-col gap-6`}>
          <p role="status" className="sr-only">
            {t(`${namespace}.loading`)}
          </p>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t(`${namespace}Form.editTitle`, { name: data.name })}
          </h1>
          {children(data)}
        </>
      ) : (
        <LoadFailure
          namespace={namespace}
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
