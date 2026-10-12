'use client'

import { useTranslations } from 'next-intl'

import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

function SettingsTabLoading() {
  const t = useTranslations('Settings')

  return (
    <div aria-busy className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  )
}

export function SettingsTabContent<TData>({
  query,
  waiting = false,
  children,
}: {
  query: UseQueryResult<TData>
  waiting?: boolean
  children: (data: TData) => ReactNode
}) {
  if (waiting || query.isPending) {
    return <SettingsTabLoading />
  }

  if (query.isError) {
    return (
      <LoadFailure namespace="Settings" notFound={false} onRetry={() => void query.refetch()} />
    )
  }

  return children(query.data)
}
