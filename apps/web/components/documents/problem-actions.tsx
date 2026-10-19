'use client'

import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  Copy01Icon,
  Refresh01Icon,
  RepeatIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { ActionError } from '@/components/documents/action-error'
import {
  MappingVersionSelect,
  useMappingVersionChoices,
} from '@/components/documents/mapping-version-select'
import { partnerMessage } from '@/components/documents/partner-message'
import {
  useLatestRunActionResult,
  useReprocessRun,
  useRetryRun,
  useWaitForTradingPartner,
} from '@/components/documents/run-actions'
import { usePlainNames } from '@/components/plain-names'
import { useCanChange } from '@/hooks/use-session'
import { mappingDraftQuery } from '@/lib/api/queries'
import { documentHref, mappingHref } from '@/lib/navigation'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { FailedRun } from '@/components/documents/failed-run'
import type { RunDetail, RunReference } from '@edi-bridge/contracts'

function ViewOnly({ text }: { text: string }) {
  return <p className="text-muted-foreground">{text}</p>
}

export type ReprocessMapping = { id: string; name: string }

export function reprocessMapping(run: FailedRun): ReprocessMapping | null {
  const target = run.problem.fixTarget

  if (target?.kind === 'mapping') {
    return { id: target.mappingId, name: target.name }
  }

  return (
    run.mappingVersion && { id: run.mappingVersion.mappingId, name: run.mappingVersion.mappingName }
  )
}

function UnpublishedChanges({ mappingId }: { mappingId: string }) {
  const t = useTranslations('Document.actions.unpublished')
  const draft = useQuery(mappingDraftQuery(mappingId))

  if (!draft.data?.unpublishedChanges) {
    return null
  }

  const mapping = draft.data.name

  return (
    <p className="text-destructive-text">
      {t('description', { mapping })}{' '}
      <Link href={mappingHref(mappingId)} className={linkClass}>
        {t('link', { mapping })}
      </Link>
    </p>
  )
}

function VersionsLoading() {
  const t = useTranslations('Document.actions')

  return (
    <div aria-busy className="flex w-full max-w-80 min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{t('version')}</span>
      <Skeleton aria-hidden className="h-8 w-full" />
      <span className="text-muted-foreground">{t('versionsLoading')}</span>
    </div>
  )
}

function ProcessAgainAction({ run, mapping }: { run: FailedRun; mapping: ReprocessMapping }) {
  const t = useTranslations('Document.actions')
  const versions = useMappingVersionChoices(mapping.id, run.mappingVersion?.id ?? null)
  const reprocess = useReprocessRun(run.id)
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? versions.choices[0]?.version.id ?? null

  if (versions.isError) {
    return <ActionError message={t('versionsUnavailable')} />
  }

  if (versions.isPending) {
    return <VersionsLoading />
  }

  if (versions.choices.length === 0) {
    return (
      <>
        <UnpublishedChanges mappingId={mapping.id} />
        <p className="text-muted-foreground">{t('noVersions', { mapping: mapping.name })}</p>
      </>
    )
  }

  return (
    <>
      <UnpublishedChanges mappingId={mapping.id} />
      <div className="flex w-full min-w-0 flex-wrap items-end gap-2">
        <MappingVersionSelect
          choices={versions.choices}
          disabled={reprocess.isPending}
          label={t('version')}
          value={selected}
          onValueChange={setChosen}
        />
        <Button
          disabled={selected === null || reprocess.isPending}
          onClick={() => selected && reprocess.mutate(selected)}>
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} aria-hidden />
          {reprocess.isPending ? t('processAgain.pending') : t('processAgain.button')}
        </Button>
      </div>
      {reprocess.isError && <ActionError message={t('processAgain.failed')} />}
    </>
  )
}

export function ProcessAgainStep({ run, mapping }: { run: FailedRun; mapping: ReprocessMapping }) {
  const t = useTranslations('Document')
  const canChange = useCanChange()

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      <p>
        {t('problem.steps.processAgain', {
          direction: run.direction,
          tradingPartner: run.tradingPartner.name,
        })}
      </p>
      {canChange ? (
        <ProcessAgainAction mapping={mapping} run={run} />
      ) : (
        <ViewOnly text={t('actions.processAgain.viewOnly')} />
      )}
    </div>
  )
}

export function TryAgainStep({ run, secondary }: { run: FailedRun; secondary: boolean }) {
  const t = useTranslations('Document')
  const canChange = useCanChange()
  const retry = useRetryRun(run.id)

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>{t('problem.steps.tryAgain', { stage: run.failureStage })}</p>
      {canChange ? (
        <Button
          disabled={retry.isPending}
          variant={secondary ? 'outline' : 'default'}
          onClick={() => retry.mutate()}>
          <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden />
          {retry.isPending ? t('actions.tryAgain.pending') : t('actions.tryAgain.button')}
        </Button>
      ) : (
        <ViewOnly text={t('actions.tryAgain.viewOnly')} />
      )}
      {retry.isError && <ActionError message={t('actions.tryAgain.failed')} />}
    </div>
  )
}

function usePartnerMessage(run: FailedRun) {
  const t = useTranslations('Document.partnerMessage')
  const plainNames = usePlainNames()

  return partnerMessage(run, {
    t: (key, values) => t(key, values),
    messageTypeName: plainNames.messageTypeNameInText(run.messageType),
  })
}

export function CopyPartnerMessage({ run }: { run: FailedRun }) {
  const t = useTranslations('Document.actions.copyMessage')
  const message = usePartnerMessage(run)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
        onClick={() => void copyMessage()}>
        <HugeiconsIcon
          icon={copy === 'copied' ? CheckmarkCircle02Icon : Copy01Icon}
          strokeWidth={2}
          aria-hidden
        />
        {copy === 'copied' ? t('copied') : t('button', { tradingPartner: run.tradingPartner.name })}
      </Button>
      <p aria-live="polite" className="sr-only">
        {copy === 'copied' && t('copied')}
      </p>
      {copy === 'failed' && <ActionError message={t('failed')} />}
    </>
  )
}

export function MarkWaitingStep({ run }: { run: FailedRun }) {
  const t = useTranslations('Document')
  const canChange = useCanChange()
  const wait = useWaitForTradingPartner(run.id)
  const marked = run.waitingForTradingPartnerSince !== null

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>{t('problem.steps.markWaiting', { tradingPartner: run.tradingPartner.name })}</p>
      {canChange ? (
        <Button disabled={marked || wait.isPending} variant="outline" onClick={() => wait.mutate()}>
          <HugeiconsIcon
            icon={marked ? CheckmarkCircle02Icon : Clock01Icon}
            strokeWidth={2}
            aria-hidden
          />
          {marked
            ? t('actions.markWaiting.marked')
            : wait.isPending
              ? t('actions.markWaiting.pending')
              : t('actions.markWaiting.button')}
        </Button>
      ) : (
        <ViewOnly text={t('actions.markWaiting.viewOnly')} />
      )}
      {wait.isError && <ActionError message={t('actions.markWaiting.failed')} />}
    </div>
  )
}

export function ProcessedAgain({ replacedBy }: { replacedBy: RunReference | null }) {
  const t = useTranslations('Document.result.replaced')

  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p>{t('description')}</p>
      {replacedBy && (
        <Link href={documentHref(replacedBy.id)} className={linkClass}>
          {t('link')}
        </Link>
      )}
    </div>
  )
}

function ReprocessedAlert({ replacing }: { replacing: RunDetail }) {
  const t = useTranslations('Document.result.reprocessed')
  const version = replacing.mappingVersion?.version

  return (
    <Alert>
      <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} aria-hidden />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        <p>
          {version === undefined ? t('descriptionWithoutVersion') : t('description', { version })}{' '}
          <Link href={documentHref(replacing.id)} className={linkClass}>
            {t('link')}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}

function RetriedAlert({ outcome }: { outcome: 'pending' | 'failedAgain' }) {
  const t = useTranslations(`Document.result.retried.${outcome}`)

  return (
    <Alert>
      <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>{t('description')}</AlertDescription>
    </Alert>
  )
}

function retriedOutcome(run: RunDetail) {
  switch (run.status) {
    case 'received':
    case 'processing': {
      return 'pending'
    }

    // Trying a Defect again before delivery starts a new Run, which the problem card links.
    case 'failed': {
      return run.replacedBy === null ? 'failedAgain' : null
    }

    case 'delivered':
    case 'duplicate': {
      return null
    }
  }
}

export function useFreshlyReprocessed(id: string) {
  return useLatestRunActionResult(id)?.action === 'reprocessed'
}

export function RunActionResultAlert({ run }: { run: RunDetail }) {
  const result = useLatestRunActionResult(run.id)

  switch (result?.action) {
    case undefined: {
      return null
    }

    case 'reprocessed': {
      return <ReprocessedAlert replacing={result.run} />
    }

    case 'retried': {
      const outcome = retriedOutcome(run)

      return outcome && <RetriedAlert outcome={outcome} />
    }
  }
}
