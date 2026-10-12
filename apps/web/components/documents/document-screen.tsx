'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import { linkClass, LoadFailure } from '@/components/detail-parts'
import { DocumentVerdict } from '@/components/documents/document-verdict'
import { ProblemCard } from '@/components/documents/problem-card'
import { RunStatusBadge } from '@/components/runs/run-status'
import { useRunTitle } from '@/components/runs/run-title'
import { ApiError } from '@/lib/api/client'
import { runQuery } from '@/lib/api/queries'
import { orderHref } from '@/lib/navigation'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { RunDetail } from '@edi-bridge/contracts'

function DocumentHeader({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.header')
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const receivedAt = new Date(run.receivedAt)
  const reference = run.businessReference

  return (
    <>
      <RunStatusBadge status={run.status} />
      <span>
        {t.rich('receivedAt', {
          direction: run.direction,
          relativeTime: format.relativeTime(receivedAt, now),
          time: (chunks) => (
            <time
              dateTime={run.receivedAt}
              title={format.dateTime(receivedAt, { dateStyle: 'medium', timeStyle: 'medium' })}>
              {chunks}
            </time>
          ),
        })}
        {run.manualSubmission && ` · ${t('uploaded')}`}
      </span>
      {reference !== null && (
        <Link href={orderHref(reference)} className={linkClass}>
          {t('order', { reference })}
        </Link>
      )}
    </>
  )
}

function DocumentView({ run }: { run: RunDetail }) {
  const title = useRunTitle(run)

  return (
    <AppPage meta={<DocumentHeader run={run} />} name={title}>
      {run.status === 'failed' ? <ProblemCard run={run} /> : <DocumentVerdict run={run} />}
    </AppPage>
  )
}

function DocumentLoading() {
  const t = useTranslations('Document')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-5 w-72 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

export function DocumentScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useQuery(runQuery(id))

  if (data) {
    return <DocumentView run={data} />
  }

  return (
    <AppPage>
      {isPending ? (
        <DocumentLoading />
      ) : (
        <LoadFailure
          namespace="Document"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
