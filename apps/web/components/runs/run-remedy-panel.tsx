'use client'

import { MailReceive01Icon, RefreshIcon, RepeatIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { runRemedy } from '@/components/runs/run-remedy'
import { reprocessRun, retryRun } from '@/lib/api/client'
import { mappingVersionsQuery, runQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'

import type { MappingVersionSummary, RunDetail } from '@edi-bridge/contracts'

function ActionError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-red-800 dark:text-red-300">
      {message}
    </p>
  )
}

function RetryAction({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy.retry')
  const queryClient = useQueryClient()

  const retry = useMutation({
    mutationFn: () => retryRun(run.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(runQuery(run.id).queryKey, updated)
      void queryClient.invalidateQueries({ queryKey: ['runs', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['interchanges'] })
    },
  })

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">{t('description')}</p>
      <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
        <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden />
        {retry.isPending ? t('pending') : t('button')}
      </Button>
      {retry.isError && <ActionError message={t('failed')} />}
    </div>
  )
}

function useVersionLabel(used: MappingVersionSummary | null) {
  const t = useTranslations('RunDetail.remedy.reprocess')
  const format = useFormatter()

  return (version: MappingVersionSummary) => {
    const option = t('option', {
      version: version.version,
      publishedAt: format.dateTime(new Date(version.publishedAt), { dateStyle: 'medium' }),
    })

    return version.id === used?.id ? t('used', { option }) : option
  }
}

function ReprocessAction({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy.reprocess')
  const queryClient = useQueryClient()
  const router = useRouter()
  const labelId = useId()
  const versionLabel = useVersionLabel(run.mappingVersion)

  const versions = useQuery({
    ...mappingVersionsQuery(run.mappingVersion?.mappingId ?? ''),
    enabled: run.mappingVersion !== null,
  })

  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? versions.data?.[0]?.id ?? null

  const reprocess = useMutation({
    mutationFn: (mappingVersionId: string) => reprocessRun(run.id, { mappingVersionId }),
    onSuccess: (replacing) => {
      queryClient.setQueryData(runQuery(replacing.id).queryKey, replacing)
      void queryClient.invalidateQueries({ queryKey: runQuery(run.id).queryKey })
      void queryClient.invalidateQueries({ queryKey: ['runs', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['interchanges'] })
      router.push(`/runs/${replacing.id}`)
    },
  })

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">{t('description')}</p>
      {versions.isError ? (
        <ActionError message={t('versionsUnavailable')} />
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <span id={labelId} className="text-sm font-medium">
              {t('version')}
            </span>
            <Select
              disabled={versions.isPending}
              items={(versions.data ?? []).map((version) => ({
                value: version.id,
                label: versionLabel(version),
              }))}
              value={selected}
              onValueChange={(value) => setChosen(value)}>
              <SelectTrigger aria-labelledby={labelId} className="min-w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.data?.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={selected === null || reprocess.isPending}
            onClick={() => selected && reprocess.mutate(selected)}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
            {reprocess.isPending ? t('pending') : t('button')}
          </Button>
        </div>
      )}
      {reprocess.isError && <ActionError message={t('failed')} />}
    </div>
  )
}

export function RunRemedyPanel({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy')
  const tRuns = useTranslations('Runs')
  const remedy = runRemedy(run)

  if (remedy === 'none' && run.status !== 'failed') {
    return null
  }

  return (
    <section aria-labelledby="run-remedy" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="run-remedy" className="font-semibold">
        {remedy === 'awaitingResend' ? t('awaitingResend.title') : t('title')}
      </h2>
      {remedy === 'retry' && <RetryAction run={run} />}
      {remedy === 'reprocess' && <ReprocessAction run={run} />}
      {remedy === 'awaitingResend' && run.failureStage !== null && (
        <p className="flex items-start gap-2 text-sm">
          <HugeiconsIcon
            icon={MailReceive01Icon}
            strokeWidth={2}
            aria-hidden
            className="mt-0.5 size-4 shrink-0"
          />
          {t('awaitingResend.description', {
            tradingPartner: run.tradingPartner.name,
            failureStage: tRuns(`failureStage.${run.failureStage}`),
          })}
        </p>
      )}
      {remedy === 'replaced' && run.replacedBy !== null && (
        <p className="text-sm">
          {t('replaced.description')}{' '}
          <Link href={`/runs/${run.replacedBy.id}`} className={linkClass}>
            {t('replaced.link')}
          </Link>
        </p>
      )}
      {remedy === 'none' && <p className="text-sm">{t('none.description')}</p>}
    </section>
  )
}
