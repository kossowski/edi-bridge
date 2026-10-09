'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BackLink, LoadFailure } from '@/components/detail-parts'
import { FlowForm } from '@/components/flows/flow-form'
import { ApiError } from '@/lib/api/client'
import { flowQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function NewFlowScreen() {
  const t = useTranslations()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/flows" label={t('Flow.back')} />
      <h1 className="text-2xl font-semibold tracking-tight">{t('FlowForm.createTitle')}</h1>
      <FlowForm />
    </div>
  )
}

export function EditFlowScreen({ id }: { id: string }) {
  const t = useTranslations()
  const { data, error, isPending, refetch } = useQuery(flowQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink
        href={data ? `/flows/${id}` : '/flows'}
        label={data ? t('FlowForm.backTo', { name: data.name }) : t('Flow.back')}
      />
      {isPending ? (
        <div aria-busy className="flex max-w-2xl flex-col gap-6">
          <p role="status" className="sr-only">
            {t('Flow.loading')}
          </p>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : data ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('FlowForm.editTitle', { name: data.name })}
          </h1>
          <FlowForm flow={data} />
        </>
      ) : (
        <LoadFailure
          namespace="Flow"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
