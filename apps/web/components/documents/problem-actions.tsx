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
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { type VersionChoice, versionChoices } from '@/components/documents/mapping-version-choices'
import { partnerMessage } from '@/components/documents/partner-message'
import {
  useLatestRunActionResult,
  useReprocessRun,
  useRetryRun,
  useWaitForTradingPartner,
} from '@/components/documents/run-actions'
import { usePlainNames } from '@/components/plain-names'
import { useCanChange } from '@/hooks/use-session'
import { mappingDraftQuery, mappingVersionsQuery } from '@/lib/api/queries'
import { documentHref, navigationItems } from '@/lib/navigation'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { FailedRun } from '@/components/documents/problem-card'
import type { RunDetail, RunReference } from '@edi-bridge/contracts'

export function ActionError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-destructive-text text-sm">
      {message}
    </p>
  )
}

function ViewOnly({ text }: { text: string }) {
  return <p className="text-muted-foreground">{text}</p>
}

export function useVersionChoiceLabel() {
  const t = useTranslations('Document.actions.versionOption')
  const format = useFormatter()

  return ({ version, labelKey }: VersionChoice) =>
    t(labelKey, {
      version: version.version,
      publishedAt: format.dateTime(new Date(version.publishedAt), { dateStyle: 'medium' }),
    })
}

export function useMappingVersionChoices(mappingId: string | null, usedBeforeId: string | null) {
  const versions = useQuery({
    ...mappingVersionsQuery(mappingId ?? ''),
    enabled: mappingId !== null,
  })

  return {
    choices: versionChoices(versions.data ?? [], usedBeforeId),
    isPending: versions.isPending,
    isError: versions.isError,
  }
}

export function MappingVersionSelect({
  label,
  choices,
  value,
  disabled,
  onValueChange,
}: {
  label: string
  choices: ReadonlyArray<VersionChoice>
  value: string | null
  disabled: boolean
  onValueChange: (value: string) => void
}) {
  const labelId = useId()
  const choiceLabel = useVersionChoiceLabel()

  const items = choices.map((choice) => ({
    value: choice.version.id,
    label: choiceLabel(choice),
  }))

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <Select
        disabled={disabled}
        items={items}
        value={value}
        onValueChange={(next) => next !== null && onValueChange(next)}>
        <SelectTrigger aria-labelledby={labelId} className="w-full sm:w-80">
          <SelectValue className="min-w-0">
            {(selected: string | null) => (
              <span className="truncate">
                {items.find((item) => item.value === selected)?.label}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function reprocessMappingId(run: FailedRun) {
  const target = run.problem.fixTarget

  return target?.kind === 'mapping' ? target.mappingId : (run.mappingVersion?.mappingId ?? null)
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
      <Link href={`${navigationItems.mappings.href}/${mappingId}`} className={linkClass}>
        {t('link', { mapping })}
      </Link>
    </p>
  )
}

function ProcessAgainAction({ run, mappingId }: { run: FailedRun; mappingId: string }) {
  const t = useTranslations('Document.actions')
  const versions = useMappingVersionChoices(mappingId, run.mappingVersion?.id ?? null)
  const reprocess = useReprocessRun(run.id)
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen ?? versions.choices[0]?.version.id ?? null

  return (
    <>
      <UnpublishedChanges mappingId={mappingId} />
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
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} aria-hidden />
            {reprocess.isPending ? t('processAgain.pending') : t('processAgain.button')}
          </Button>
        </div>
      )}
      {reprocess.isError && <ActionError message={t('processAgain.failed')} />}
    </>
  )
}

export function ProcessAgainStep({ run, mappingId }: { run: FailedRun; mappingId: string }) {
  const t = useTranslations('Document')
  const canChange = useCanChange()

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>
        {t('problem.steps.processAgain', {
          direction: run.direction,
          tradingPartner: run.tradingPartner.name,
        })}
      </p>
      {canChange ? (
        <ProcessAgainAction mappingId={mappingId} run={run} />
      ) : (
        <ViewOnly text={t('actions.processAgain.viewOnly')} />
      )}
    </div>
  )
}

export function TryAgainStep({ run }: { run: FailedRun }) {
  const t = useTranslations('Document')
  const canChange = useCanChange()
  const retry = useRetryRun(run.id)

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>{t('problem.steps.tryAgain')}</p>
      {canChange ? (
        <Button disabled={retry.isPending} onClick={() => retry.mutate()}>
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
  const locale = useLocale()
  const plainNames = usePlainNames()
  const name = plainNames.messageTypeName(run.messageType)

  return partnerMessage(run, {
    t: (key, values) => t(key, values),
    messageTypeName: locale === 'de' ? name : name.toLocaleLowerCase(locale),
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
      <Button variant="outline" onClick={() => void copyMessage()}>
        <HugeiconsIcon
          icon={copy === 'copied' ? CheckmarkCircle02Icon : Copy01Icon}
          strokeWidth={2}
          aria-hidden
        />
        {t('button', { tradingPartner: run.tradingPartner.name })}
      </Button>
      <p aria-live="polite" className={cn('text-muted-foreground', copy !== 'copied' && 'sr-only')}>
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

export function ProcessedAgain({ replacedBy }: { replacedBy: RunReference }) {
  const t = useTranslations('Document.result.replaced')

  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p>{t('description')}</p>
      <Link href={documentHref(replacedBy.id)} className={linkClass}>
        {t('link')}
      </Link>
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

function RetriedAlert() {
  const t = useTranslations('Document.result.retried')

  return (
    <Alert>
      <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>{t('description')}</AlertDescription>
    </Alert>
  )
}

export function RunActionResultAlert({ id }: { id: string }) {
  const result = useLatestRunActionResult(id)

  switch (result?.action) {
    case undefined: {
      return null
    }

    case 'reprocessed': {
      return <ReprocessedAlert replacing={result.run} />
    }

    case 'retried': {
      return <RetriedAlert />
    }
  }
}
