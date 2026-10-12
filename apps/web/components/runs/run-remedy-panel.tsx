'use client'

import { MailReceive01Icon, RefreshIcon, RepeatIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { ActionError } from '@/components/documents/action-error'
import {
  MappingVersionSelect,
  useMappingVersionChoices,
} from '@/components/documents/mapping-version-select'
import { useReprocessRun, useRetryRun } from '@/components/documents/run-actions'
import { usePlainNames } from '@/components/plain-names'
import { type RunRemedy, runRemedy } from '@/components/runs/run-remedy'
import { useCanChange } from '@/hooks/use-session'
import { runHref } from '@/lib/navigation'
import { Button } from '@edi-bridge/ui/components/button'

import type { RunDetail } from '@edi-bridge/contracts'

function RetryAction({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy.retry')
  const retry = useRetryRun(run.id)

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

function ReprocessAction({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy.reprocess')
  const router = useRouter()
  const mappingId = run.mappingVersion?.mappingId ?? null
  const versions = useMappingVersionChoices(mappingId, run.mappingVersion?.id ?? null)

  const reprocess = useReprocessRun(run.id, {
    onReprocessed: (replacing) => router.push(runHref(replacing.id)),
  })

  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? versions.choices[0]?.version.id ?? null

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm">{t('description')}</p>
      {versions.isError ? (
        <ActionError message={t('versionsUnavailable')} />
      ) : (
        <div className="flex w-full flex-wrap items-end gap-2">
          <MappingVersionSelect
            choices={versions.choices}
            disabled={versions.isPending}
            label={t('version')}
            value={selected}
            onValueChange={setChosen}
          />
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

const remedyActions = { retry: RetryAction, reprocess: ReprocessAction }

type ActionRemedy = keyof typeof remedyActions

function hasAction(remedy: RunRemedy): remedy is ActionRemedy {
  return remedy in remedyActions
}

function RemedyAction({ remedy, run }: { remedy: ActionRemedy; run: RunDetail }) {
  const Action = remedyActions[remedy]

  return <Action run={run} />
}

function ViewOnlyRemedy({ remedy }: { remedy: ActionRemedy }) {
  const t = useTranslations('RunDetail.remedy')

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">{t(`${remedy}.description`)}</p>
      <p className="text-muted-foreground text-sm">{t(`${remedy}.viewOnly`)}</p>
    </div>
  )
}

export function RunRemedyPanel({ run }: { run: RunDetail }) {
  const t = useTranslations('RunDetail.remedy')
  const plainNames = usePlainNames()
  const remedy = runRemedy(run)
  const canChange = useCanChange()

  if (remedy === 'none' && run.status !== 'failed') {
    return null
  }

  return (
    <section aria-labelledby="run-remedy" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="run-remedy" className="font-semibold">
        {remedy === 'awaitingResend' ? t('awaitingResend.title') : t('title')}
      </h2>
      {hasAction(remedy) &&
        (canChange ? (
          <RemedyAction remedy={remedy} run={run} />
        ) : (
          <ViewOnlyRemedy remedy={remedy} />
        ))}
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
            failureStage: plainNames.failureStageTitle(run.failureStage),
          })}
        </p>
      )}
      {remedy === 'replaced' && run.replacedBy !== null && (
        <p className="text-sm">
          {t('replaced.description')}{' '}
          <Link href={runHref(run.replacedBy.id)} className={linkClass}>
            {t('replaced.link')}
          </Link>
        </p>
      )}
      {remedy === 'none' && <p className="text-sm">{t('none.description')}</p>}
    </section>
  )
}
