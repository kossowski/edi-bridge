'use client'

import { Alert02Icon, ArrowRight01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { FixerBadge, fixerIcons, shownFixer } from '@/components/documents/fixer-badge'
import { invalidContentCode } from '@/components/documents/invalid-content'
import {
  CopyPartnerMessage,
  DocumentExpiredStep,
  MarkWaitingStep,
  ProcessAgainStep,
  ProcessedAgain,
  reprocessMapping,
  retryReprocesses,
  TryAgainStep,
  useFreshlyReprocessed,
} from '@/components/documents/problem-actions'
import { useCanChange } from '@/hooks/use-session'
import { channelSettingsHref, fixTargetHref } from '@/lib/navigation'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@edi-bridge/ui/components/card'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { FailedRun } from '@/components/documents/failed-run'
import type { FixTarget } from '@edi-bridge/contracts'

export type WhatToDoStep = { key: string; content: ReactNode }

// Trying again reprocesses the Run, which needs the Document that retention may have deleted.
function retryDocumentDeletedAt(run: FailedRun): string | null {
  return retryReprocesses(run) ? run.documentDeletedAt : null
}

function blockedAddressOf(run: FailedRun) {
  return run.error.details?.kind === 'blockedAddress' ? run.error.details.address : ''
}

function useProblemText(run: FailedRun) {
  const t = useTranslations('Document.problem.reason')
  const { problem, error, direction, failureStage, tradingPartner } = run
  const { fixTarget } = problem
  const field = fixTarget?.kind === 'mapping' ? fixTarget.fieldPath : null
  const lookupTable = fixTarget?.kind === 'lookupTable' ? fixTarget : null
  const values = { direction, tradingPartner: tradingPartner.name }

  switch (problem.reason) {
    case 'unreadable': {
      return {
        title: t('unreadable.title', values),
        description: t('unreadable.description', values),
      }
    }

    case 'invalidContent': {
      const code = invalidContentCode(error.code)
      const described = { ...values, problem: t(`invalidContent.problem.${code}`) }

      return {
        title: t(`invalidContent.title.${code}`),
        description:
          direction === 'outbound' && field === null
            ? t('invalidContent.descriptionWithoutTarget', described)
            : t('invalidContent.description', { ...described, field: field ?? '' }),
      }
    }

    case 'missingCode': {
      return lookupTable
        ? {
            title: t('missingCode.title', { code: lookupTable.code }),
            description: t('missingCode.description', {
              ...values,
              code: lookupTable.code,
              lookupTable: lookupTable.name,
            }),
          }
        : {
            title: t('missingCode.titleWithoutTarget'),
            description: t('missingCode.descriptionWithoutTarget', values),
          }
    }

    case 'missingField': {
      return {
        title: t('missingField.title'),
        description:
          field === null
            ? t('missingField.descriptionWithoutTarget')
            : t('missingField.description', { field }),
      }
    }

    case 'unreachable': {
      if (error.code === 'seededChannel') {
        return { title: t('seededChannel.title'), description: t('seededChannel.description') }
      }

      return {
        title: t('unreachable.title', values),
        description: t('unreachable.description', values),
      }
    }

    case 'hostKeyMismatch': {
      return {
        title: t('hostKeyMismatch.title', values),
        description: t('hostKeyMismatch.description', values),
      }
    }

    case 'addressBlocked': {
      return {
        title: t('addressBlocked.title', values),
        description: t('addressBlocked.description', { ...values, address: blockedAddressOf(run) }),
      }
    }

    case 'passphraseRejected': {
      return {
        title: t('passphraseRejected.title', values),
        description: t('passphraseRejected.description', values),
      }
    }

    case 'incompleteSetup': {
      return {
        title: t('incompleteSetup.title', values),
        description: t('incompleteSetup.description', {
          ...values,
          piece: fixTarget?.kind ?? 'other',
        }),
      }
    }

    case 'defect': {
      return {
        title: t('defect.title'),
        description: t('defect.description', {
          stage: failureStage,
          retry: retryDocumentDeletedAt(run) === null ? 'available' : 'documentExpired',
        }),
      }
    }
  }
}

type ChannelSetting = 'address' | 'passphrase'

const channelSettingLabels = {
  address: 'channelAddress',
  passphrase: 'channelPassphrase',
} as const satisfies Record<ChannelSetting, string>

function FixLink({
  target,
  runId,
  primary,
  channelSetting,
}: {
  target: FixTarget
  runId: string
  primary: boolean
  channelSetting?: ChannelSetting | undefined
}) {
  const t = useTranslations('Document.problem.fixLink')
  const canChange = useCanChange()
  // Only an Admin can open the Channel settings; a Viewer sees the Channel on its page.
  const channelSettings = channelSetting !== undefined && canChange && target.kind === 'channel'

  const label = channelSettings
    ? t(channelSettingLabels[channelSetting], { name: target.name })
    : target.kind === 'lookupTable'
      ? t('lookupTable', { code: target.code, name: target.name })
      : t(target.kind, { name: target.name })

  return (
    <Link
      href={channelSettings ? channelSettingsHref(target.channelId) : fixTargetHref(target, runId)}
      className={cn(
        buttonVariants({ variant: primary ? 'default' : 'outline' }),
        'h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal',
      )}>
      {label}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden data-icon="inline-end" />
    </Link>
  )
}

function StepBody({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>{text}</p>
      {children}
    </div>
  )
}

type FixLinkOptions = {
  primary: boolean
  // Sends an Admin to the Channel settings to change this setting.
  channelSetting?: ChannelSetting
}

function fixStep(
  text: string,
  run: FailedRun,
  target: FixTarget,
  { primary, channelSetting }: FixLinkOptions,
): WhatToDoStep {
  return {
    key: 'fix',
    content: (
      <StepBody text={text}>
        <FixLink channelSetting={channelSetting} primary={primary} runId={run.id} target={target} />
      </StepBody>
    ),
  }
}

function documentExpiredStep(run: FailedRun, deletedAt: string, afterFix: boolean): WhatToDoStep {
  return {
    key: 'documentExpired',
    content: <DocumentExpiredStep afterFix={afterFix} deletedAt={deletedAt} run={run} />,
  }
}

export function useFixSteps(run: FailedRun): WhatToDoStep[] {
  const t = useTranslations('Document.problem.steps')
  const { problem, tradingPartner } = run
  const target = problem.fixTarget

  switch (problem.whoFixes) {
    case 'you': {
      // A retry fails until the server's new key is accepted on the connection.
      if (problem.reason === 'hostKeyMismatch' && target) {
        return [
          fixStep(
            t('acceptHostKey', {
              direction: run.direction,
              tradingPartner: tradingPartner.name,
            }),
            run,
            target,
            { primary: true },
          ),
          { key: 'tryAgain', content: <TryAgainStep run={run} secondary /> },
        ]
      }

      // A retry is refused until the Channel's host no longer resolves to a blocked address.
      if (problem.reason === 'addressBlocked' && target) {
        return [
          fixStep(t('changeAddress', { address: blockedAddressOf(run) }), run, target, {
            primary: true,
            channelSetting: 'address',
          }),
          { key: 'tryAgain', content: <TryAgainStep run={run} secondary /> },
        ]
      }

      // A retry fails until the passphrase on the Channel unlocks its private key.
      if (problem.reason === 'passphraseRejected' && target) {
        return [
          fixStep(
            t('correctPassphrase', {
              direction: run.direction,
              tradingPartner: tradingPartner.name,
            }),
            run,
            target,
            { primary: true, channelSetting: 'passphrase' },
          ),
          { key: 'tryAgain', content: <TryAgainStep run={run} secondary /> },
        ]
      }

      const mapping = reprocessMapping(run)

      if (target === null && mapping === null) {
        return [
          {
            key: 'fix',
            content: (
              <StepBody
                text={t('fixCauseWithoutTarget', {
                  direction: run.direction,
                  tradingPartner: tradingPartner.name,
                })}
              />
            ),
          },
        ]
      }

      return [
        ...(target ? [fixStep(t('fixCause'), run, target, { primary: true })] : []),
        ...(mapping
          ? [
              run.documentDeletedAt === null
                ? {
                    key: 'processAgain',
                    content: <ProcessAgainStep mapping={mapping} run={run} />,
                  }
                : documentExpiredStep(run, run.documentDeletedAt, target !== null),
            ]
          : []),
      ]
    }

    case 'retry': {
      const deletedAt = retryDocumentDeletedAt(run)

      if (deletedAt !== null) {
        return [documentExpiredStep(run, deletedAt, false)]
      }

      // The setup has to be complete before trying again can work.
      if (problem.reason === 'incompleteSetup' && target) {
        return [
          fixStep(t('completeSetup'), run, target, { primary: true }),
          { key: 'tryAgain', content: <TryAgainStep run={run} secondary /> },
        ]
      }

      return [
        { key: 'tryAgain', content: <TryAgainStep run={run} secondary={false} /> },
        ...(target ? [fixStep(t('checkConnection'), run, target, { primary: false })] : []),
      ]
    }

    case 'tradingPartner': {
      return [
        {
          key: 'tell',
          content: (
            <StepBody text={t('tellTradingPartner', { tradingPartner: tradingPartner.name })}>
              <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
                <CopyPartnerMessage run={run} />
                {target && <FixLink primary={false} runId={run.id} target={target} />}
              </div>
            </StepBody>
          ),
        },
        { key: 'markWaiting', content: <MarkWaitingStep run={run} /> },
      ]
    }
  }
}

function WhatToDo({ children }: { children: ReactNode }) {
  const t = useTranslations('Document.problem')

  return (
    <section aria-labelledby="what-to-do" className="flex min-w-0 flex-col gap-3">
      <h3 id="what-to-do" tabIndex={-1} className="scroll-mt-20 text-sm font-semibold outline-none">
        {t('whatToDo')}
      </h3>
      {children}
    </section>
  )
}

function Steps({ steps }: { steps: ReadonlyArray<WhatToDoStep> }) {
  return (
    <ol className="flex flex-col gap-4 text-sm">
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-3">
          <span
            aria-hidden
            className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {index + 1}
          </span>
          {step.content}
        </li>
      ))}
    </ol>
  )
}

function WaitingNote({ run, since }: { run: FailedRun; since: string }) {
  const t = useTranslations('Document.problem')
  const format = useFormatter()

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} aria-hidden className="size-4 shrink-0" />
      <span>
        {t.rich('waiting', {
          tradingPartner: run.tradingPartner.name,
          since: format.dateTime(new Date(since), { dateStyle: 'medium', timeStyle: 'short' }),
          time: (chunks) => <time dateTime={since}>{chunks}</time>,
        })}
      </span>
    </p>
  )
}

export function ProblemCard({ run }: { run: FailedRun }) {
  const t = useTranslations('Document.problem')
  const { title, description } = useProblemText(run)
  const steps = useFixSteps(run)
  const freshlyReprocessed = useFreshlyReprocessed(run.id)
  const fixer = shownFixer(run.problem.whoFixes, run.problem.reason)

  return (
    <Card className="ring-destructive/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-destructive-text size-5 shrink-0"
          />
          <CardTitle className="text-lg">
            <h2>{title}</h2>
          </CardTitle>
          <FixerBadge fixer={fixer} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="what-happened" className="flex min-w-0 flex-col gap-2">
          <h3 id="what-happened" className="text-sm font-semibold">
            {t('whatHappened')}
          </h3>
          <p className="text-muted-foreground text-sm">{description}</p>
          <p className="flex items-start gap-2 text-sm">
            <HugeiconsIcon
              icon={fixerIcons[fixer]}
              strokeWidth={2}
              aria-hidden
              className="mt-0.5 size-4 shrink-0"
            />
            {t(`whoFixes.${fixer}`, { tradingPartner: run.tradingPartner.name })}
          </p>
          {run.waitingForTradingPartnerSince !== null && (
            <WaitingNote run={run} since={run.waitingForTradingPartnerSince} />
          )}
        </section>
        <WhatToDo>
          {run.replacedBy || freshlyReprocessed ? (
            <ProcessedAgain replacedBy={freshlyReprocessed ? null : run.replacedBy} />
          ) : (
            <Steps steps={steps} />
          )}
        </WhatToDo>
      </CardContent>
    </Card>
  )
}
