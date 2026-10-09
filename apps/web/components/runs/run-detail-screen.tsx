'use client'

import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import { BackToRuns, Fact, linkClass, LoadFailure, Section } from '@/components/detail-parts'
import { MessageTree } from '@/components/runs/message-tree'
import { RawInterchange } from '@/components/runs/raw-interchange'
import { RunRemedyPanel } from '@/components/runs/run-remedy-panel'
import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
import { RunTimeline } from '@/components/runs/run-timeline'
import { ApiError } from '@/lib/api/client'
import { runQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { ErrorPosition, RunDetail } from '@edi-bridge/contracts'

function shortId(id: string) {
  return id.slice(0, 8)
}

function PositionText({ position }: { position: ErrorPosition }) {
  const t = useTranslations('RunDetail.failure')

  return [
    t('segment', { segment: position.segment, tag: position.tag }),
    position.element !== null && t('element', { element: position.element }),
    position.component !== null && t('component', { component: position.component }),
  ]
    .filter(Boolean)
    .join(', ')
}

function RunFacts({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail')
  const tRuns = useTranslations('Runs')
  const format = useFormatter()

  return (
    <dl
      aria-label={t('facts.label')}
      className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
      <Fact label={t('facts.receivedAt')}>
        <time dateTime={run.receivedAt}>
          {format.dateTime(new Date(run.receivedAt), { dateStyle: 'medium', timeStyle: 'medium' })}
        </time>
      </Fact>
      <Fact label={t('facts.tradingPartner')}>{run.tradingPartner.name}</Fact>
      <Fact label={t('facts.messageType')}>
        <code className="font-mono">{run.messageType}</code>
      </Fact>
      <Fact label={t('facts.direction')}>{t(`direction.${run.direction}`)}</Fact>
      <Fact label={t('facts.flow')}>{run.flow.name}</Fact>
      <Fact label={t('facts.source')}>
        {run.manualSubmission
          ? tRuns('manualSubmission.manual')
          : tRuns('manualSubmission.channel')}
      </Fact>
      <Fact label={t('facts.mappingVersion')}>
        {run.mappingVersion
          ? t('mappingVersion', {
              mappingName: run.mappingVersion.mappingName,
              version: run.mappingVersion.version,
            })
          : t('notMapped')}
      </Fact>
      <Fact label={t('facts.interchange')}>
        {run.interchange ? (
          <Link href={`/interchanges/${run.interchange.id}`} className={linkClass}>
            {t('interchangeLink', { controlReference: run.interchange.controlReference })}
          </Link>
        ) : (
          t('noInterchange')
        )}
      </Fact>
      {run.replaces && (
        <Fact label={t('facts.replaces')}>
          <Link href={`/runs/${run.replaces.id}`} className={linkClass}>
            {t('runLink', { id: shortId(run.replaces.id) })}
          </Link>
        </Fact>
      )}
      {run.replacedBy && (
        <Fact label={t('facts.replacedBy')}>
          <Link href={`/runs/${run.replacedBy.id}`} className={linkClass}>
            {t('runLink', { id: shortId(run.replacedBy.id) })}
          </Link>
        </Fact>
      )}
    </dl>
  )
}

function RunErrorNotice({ error }: { error: NonNullable<RunDetail['error']> }) {
  const t = useTranslations('RunDetail.failure')

  return (
    <section
      aria-labelledby="run-error"
      className="flex flex-col gap-1 rounded-lg border border-red-600/60 p-4 text-sm dark:border-red-400/60">
      <h2
        id="run-error"
        className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-300">
        <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} aria-hidden className="size-4" />
        {t('title')}
      </h2>
      <p>{error.message}</p>
      <p className="text-muted-foreground font-mono text-xs">
        {t('code', { code: error.code })}
        {error.position && (
          <>
            {' · '}
            <PositionText position={error.position} />
          </>
        )}
      </p>
    </section>
  )
}

function RunDetailView({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail')

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <RunStatusBadge status={run.status} />
          {run.failureStage && (
            <span className="text-sm">
              <FailureStageLabel failureStage={run.failureStage} />
            </span>
          )}
        </div>
        <p className="text-muted-foreground font-mono text-sm break-all">{run.id}</p>
      </div>
      <RunFacts run={run} />
      {run.error && <RunErrorNotice error={run.error} />}
      <RunRemedyPanel run={run} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section id="run-steps" title={t('steps.title')}>
          <RunTimeline steps={run.steps} />
        </Section>
        <Section id="run-raw" title={t('raw.title')}>
          {run.interchange ? (
            <RawInterchange position={run.error?.position ?? null} raw={run.interchange.raw} />
          ) : (
            <p className="text-muted-foreground text-sm">{t('raw.none')}</p>
          )}
        </Section>
      </div>
      <Section id="run-tree" title={t('tree.title')}>
        {run.message ? (
          <MessageTree message={run.message} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {run.failureStage === 'parse' ? t('tree.unparsed') : t('tree.none')}
          </p>
        )}
      </Section>
    </>
  )
}

function RunDetailLoading() {
  const t = useTranslations('RunDetail')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  )
}

export function RunDetailScreen({ id }: { id: string }) {
  const t = useTranslations('RunDetail')
  const { data, error, isPending, refetch } = useQuery(runQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackToRuns label={t('back')} />
      {isPending ? (
        <RunDetailLoading />
      ) : data ? (
        <RunDetailView run={data} />
      ) : (
        <LoadFailure
          namespace="RunDetail"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
