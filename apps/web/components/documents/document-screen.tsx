'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Suspense, useEffect } from 'react'

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
import {
  isTestTransmission,
  TestTransmissionBadge,
} from '@/components/documents/test-transmission-badge'
import { useLocationHash } from '@/hooks/use-location-hash'
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
      {isTestTransmission(run) && <TestTransmissionBadge />}
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

// The document loads after the navigation, so the browser finds no target for the hash itself.
function useHashTarget() {
  const hash = useLocationHash()

  useEffect(() => {
    const target = hash === '' ? null : document.getElementById(hash)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    target?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })
    target?.focus({ preventScroll: true })
  }, [hash])
}

function DocumentView({ run }: { run: RunDetail }) {
  const title = useRunTitle(run)

  useHashTarget()

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

// No live event reaches this screen, so it reads a Run in progress again until it ends.
const inProgressPollMs = 2000

function inProgress(run: RunDetail) {
  return run.status === 'received' || run.status === 'processing'
}

export function DocumentScreen({ id }: { id: string }) {
  const t = useTranslations('Document')

  const { data, error, isPending, refetch } = useQuery({
    ...runQuery(id),
    refetchInterval: ({ state }) =>
      state.data && inProgress(state.data) ? inProgressPollMs : false,
  })

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
