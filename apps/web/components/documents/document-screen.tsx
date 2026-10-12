'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { linkClass, LoadFailure, Loading } from '@/components/detail-parts'
import { DocumentPathCard } from '@/components/documents/document-path-card'
import { DocumentTabs } from '@/components/documents/document-tabs'
import { DocumentVerdict } from '@/components/documents/document-verdict'
import { RunActionResultAlert } from '@/components/documents/problem-actions'
import { ProblemCard } from '@/components/documents/problem-card'
import { RelativeTime } from '@/components/documents/relative-time'
import { RunStatusBadge } from '@/components/documents/run-status'
import { useRunTitle } from '@/components/documents/run-title'
import { ApiError } from '@/lib/api/client'
import { runQuery } from '@/lib/api/queries'
import { navigationItems, orderHref } from '@/lib/navigation'
import { buttonVariants } from '@edi-bridge/ui/components/button'

import type { RunDetail } from '@edi-bridge/contracts'

function DocumentHeader({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.header')
  const reference = run.businessReference

  return (
    <>
      <RunStatusBadge status={run.status} />
      <span>
        {t('receivedAt', { direction: run.direction })} <RelativeTime dateTime={run.receivedAt} />
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
      <RunActionResultAlert run={run} />
      {run.status === 'failed' ? <ProblemCard run={run} /> : <DocumentVerdict run={run} />}
      <DocumentPathCard run={run} />
      <Suspense>
        <DocumentTabs run={run} />
      </Suspense>
    </AppPage>
  )
}

export function DocumentScreen({ id }: { id: string }) {
  const t = useTranslations('Document')
  const { data, error, isPending, refetch } = useQuery(runQuery(id))

  if (data) {
    return <DocumentView run={data} />
  }

  return (
    <AppPage>
      {isPending ? (
        <Loading label={t('loading')} rowClassName="h-24" rows={2} />
      ) : (
        <LoadFailure
          namespace="Document"
          notFound={error instanceof ApiError && error.status === 404}
          notFoundAction={
            <Link href={navigationItems.documents.href} className={buttonVariants()}>
              {t('notFound.back')}
            </Link>
          }
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
