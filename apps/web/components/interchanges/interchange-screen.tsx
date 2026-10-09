'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import { BackToRuns, Fact, LoadFailure, Section } from '@/components/detail-parts'
import { RawInterchange } from '@/components/runs/raw-interchange'
import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
import { ApiError } from '@/lib/api/client'
import { interchangeQuery } from '@/lib/api/queries'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'

import type { Interchange, InterchangeParty } from '@edi-bridge/contracts'

function Party({ party }: { party: InterchangeParty }) {
  const t = useTranslations('Interchange.facts')

  return t('party', { name: party.name, gln: party.gln })
}

function InterchangeRuns({ interchange }: { interchange: Interchange }) {
  const t = useTranslations('Interchange.runs')
  const tRuns = useTranslations('Runs')
  const format = useFormatter()

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t('count', { count: interchange.runs.length })}
      </p>
      <div className="rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{tRuns('columns.receivedAt')}</TableHead>
              <TableHead scope="col">{tRuns('columns.status')}</TableHead>
              <TableHead scope="col">{tRuns('columns.failureStage')}</TableHead>
              <TableHead scope="col">{tRuns('columns.messageType')}</TableHead>
              <TableHead scope="col">{tRuns('columns.flow')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {interchange.runs.map((run) => (
              <TableRow key={run.id} className="relative">
                <TableCell>
                  <Link
                    href={`/runs/${run.id}`}
                    className="focus-visible:after:ring-ring font-medium tabular-nums underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
                    <time dateTime={run.receivedAt}>
                      {format.dateTime(new Date(run.receivedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </time>
                    <span className="sr-only">
                      {' '}
                      {tRuns('openRun', {
                        tradingPartner: run.tradingPartner.name,
                        messageType: run.messageType,
                      })}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  <FailureStageLabel failureStage={run.failureStage} />
                </TableCell>
                <TableCell className="font-mono text-xs">{run.messageType}</TableCell>
                <TableCell>{run.flow.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function InterchangeView({ interchange }: { interchange: Interchange }) {
  const t = useTranslations('Interchange')
  const tRun = useTranslations('RunDetail')

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('heading', { controlReference: interchange.controlReference })}
        </h1>
        <p className="text-muted-foreground font-mono text-sm break-all">{interchange.id}</p>
      </div>
      <dl
        aria-label={t('facts.label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
        <Fact label={t('facts.direction')}>{tRun(`direction.${interchange.direction}`)}</Fact>
        <Fact label={t('facts.sender')}>
          <Party party={interchange.sender} />
        </Fact>
        <Fact label={t('facts.receiver')}>
          <Party party={interchange.receiver} />
        </Fact>
      </dl>
      <Section id="interchange-runs" title={t('runs.title')}>
        <InterchangeRuns interchange={interchange} />
      </Section>
      <Section id="interchange-raw" title={tRun('raw.title')}>
        <RawInterchange position={null} raw={interchange.raw} />
      </Section>
    </>
  )
}

function InterchangeLoading() {
  const t = useTranslations('Interchange')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

export function InterchangeScreen({ id }: { id: string }) {
  const t = useTranslations('Interchange')
  const { data, error, isPending, refetch } = useQuery(interchangeQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackToRuns label={t('back')} />
      {isPending ? (
        <InterchangeLoading />
      ) : data ? (
        <InterchangeView interchange={data} />
      ) : (
        <LoadFailure
          namespace="Interchange"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
