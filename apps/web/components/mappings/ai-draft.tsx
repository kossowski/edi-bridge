'use client'

import { AiMagicIcon, RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ComponentProps, type RefObject, useEffect, useId, useRef, useState } from 'react'

import { AiDraftBudget } from '@/components/mappings/ai-draft-budget'
import { AiDraftProgress, StepIcon, useStepText } from '@/components/mappings/ai-draft-progress'
import {
  type AiDraftRun,
  budgetBlocksStart,
  canRetry,
  chosenSampleId,
  type EndedAiDraftRun,
  isEnded,
  lastRound,
  outcomeKey,
  runPresentation,
} from '@/components/mappings/ai-draft-run'
import { AiDraftSamplePicker } from '@/components/mappings/ai-draft-sample-picker'
import { useSideTitle } from '@/components/mappings/mapping-side'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { type AiDraftRunControls } from '@/components/mappings/use-ai-draft-run'
import { aiBudgetQuery, mappingSamplesQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'

import type { MappingDraft } from '@edi-bridge/contracts'

function useOutcomeDescription() {
  const t = useTranslations('Mapping.aiDraft.outcome')

  return (run: EndedAiDraftRun) =>
    run.status === 'drafted'
      ? t('drafted.description', { links: run.linkCount, transforms: run.transformCount })
      : t(`${outcomeKey(run)}.description`, { rounds: lastRound(run) })
}

function useStatusText(run: AiDraftRun) {
  const t = useTranslations('Mapping.aiDraft')
  const stepText = useStepText()
  const outcomeDescription = useOutcomeDescription()

  if (isEnded(run)) {
    return outcomeDescription(run)
  }

  if (run.status === 'running') {
    const last = run.steps.at(-1)

    return last ? stepText(last) : t('starting')
  }

  return ''
}

function Outcome({
  run,
  headingRef,
}: {
  run: EndedAiDraftRun
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useTranslations('Mapping.aiDraft.outcome')
  const outcomeDescription = useOutcomeDescription()

  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-3 data-[tone=failed]:border-red-700/40 data-[tone=failed]:bg-red-50 data-[tone=success]:border-emerald-700/40 data-[tone=success]:bg-emerald-50 dark:data-[tone=failed]:border-red-400/40 dark:data-[tone=failed]:bg-red-950/40 dark:data-[tone=success]:border-emerald-400/40 dark:data-[tone=success]:bg-emerald-950/40"
      data-tone={runPresentation(run).tone}>
      <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        {t(`${outcomeKey(run)}.title`)}
      </h3>
      <p>{outcomeDescription(run)}</p>
    </div>
  )
}

function useStartBlocker(mappingId: string, chosen: string | null) {
  const samples = useQuery(mappingSamplesQuery(mappingId))
  const budget = useQuery(aiBudgetQuery)
  const sampleId = chosenSampleId(chosen, samples.data)

  if (sampleId === null) {
    return { sampleId, blocker: 'samples' as const }
  }

  return {
    sampleId,
    blocker: budget.data && budgetBlocksStart(budget.data) ? ('budget' as const) : null,
  }
}

function AiDraftDialogBody({
  draft,
  aiDraft: { run, start, stop, reset },
  sampleRef,
  stopRef,
  outcomeRef,
  onClose,
}: {
  draft: MappingDraft
  aiDraft: AiDraftRunControls
  sampleRef: RefObject<HTMLButtonElement | null>
  stopRef: RefObject<HTMLButtonElement | null>
  outcomeRef: RefObject<HTMLHeadingElement | null>
  onClose: () => void
}) {
  const t = useTranslations('Mapping.aiDraft')
  const sideTitle = useSideTitle()
  const [chosen, setChosen] = useState<string | null>(null)
  const { sampleId, blocker } = useStartBlocker(draft.mappingId, chosen)
  const budgetNoticeId = useId()
  const samplesNoticeId = useId()
  const statusText = useStatusText(run)
  const { phase } = runPresentation(run)
  const previousPhase = useRef(phase)

  useEffect(() => {
    if (previousPhase.current === phase) {
      return
    }

    previousPhase.current = phase

    const focusTarget = { choosing: sampleRef, running: stopRef, ended: outcomeRef }[phase]

    focusTarget.current?.focus()
  }, [phase, sampleRef, stopRef, outcomeRef])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <p role="status" className="sr-only">
        {statusText}
      </p>
      {phase === 'choosing' ? (
        <div className="flex flex-col gap-4">
          <AiDraftSamplePicker
            chosen={chosen}
            mappingId={draft.mappingId}
            noticeId={samplesNoticeId}
            triggerRef={sampleRef}
            onChoose={setChosen}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-medium">{t('source')}</dt>
            <dd className="min-w-0 break-words">{sideTitle(draft.source)}</dd>
            <dt className="font-medium">{t('target')}</dt>
            <dd className="min-w-0 break-words">{sideTitle(draft.target)}</dd>
          </dl>
          <AiDraftBudget noticeId={budgetNoticeId} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AiDraftProgress run={run} />
          {isEnded(run) ? (
            <Outcome headingRef={outcomeRef} run={run} />
          ) : (
            <p className="text-muted-foreground">{t('staysOpen')}</p>
          )}
        </div>
      )}
      <DialogFooter>
        {phase === 'choosing' && (
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
        )}
        {phase === 'running' && (
          <Button ref={stopRef} variant="outline" onClick={stop}>
            {t('stop')}
          </Button>
        )}
        {canRetry(run) && (
          <Button variant="outline" onClick={reset}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
            {t('retry')}
          </Button>
        )}
        {phase === 'choosing' ? (
          <Button
            disabled={blocker !== null}
            focusableWhenDisabled
            aria-describedby={
              blocker ? { budget: budgetNoticeId, samples: samplesNoticeId }[blocker] : undefined
            }
            onClick={() => sampleId && start(sampleId)}>
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />
            {t('start')}
          </Button>
        ) : (
          phase === 'ended' && <Button onClick={onClose}>{t('close')}</Button>
        )}
      </DialogFooter>
    </>
  )
}

type OpenChangeDetails = Parameters<NonNullable<ComponentProps<typeof Dialog>['onOpenChange']>>[1]

function useActionLabel(run: AiDraftRun) {
  const t = useTranslations('Mapping.aiDraft')

  if (run.status === 'running') {
    const step = run.steps.at(-1)?.kind ?? 'starting'

    return {
      icon: <StepIcon state="current" />,
      label: t('running', { step: t(`stepShort.${step}`) }),
    }
  }

  return {
    icon: <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />,
    label: isEnded(run) ? t('ended') : t('button'),
  }
}

// The dialog's open state belongs to the editor, which also opens it from "Start here" and the
// start link. Without the action, which an open review hides, focus goes back to the review.
export function AiDraftAction({
  draft,
  aiDraft,
  reviewTriggerRef,
  open,
  onOpenChange,
}: {
  draft: MappingDraft
  aiDraft: AiDraftRunControls
  reviewTriggerRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('Mapping.aiDraft')
  const [seenRun, setSeenRun] = useState<AiDraftRun | null>(null)
  const outcomeDescription = useOutcomeDescription()
  const actionRef = useRef<HTMLButtonElement>(null)
  const sampleRef = useRef<HTMLButtonElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const outcomeRef = useRef<HTMLHeadingElement>(null)
  const { run } = aiDraft
  const { phase } = runPresentation(run)
  const running = phase === 'running'
  const action = useActionLabel(run)

  function changeOpen(next: boolean, details?: OpenChangeDetails) {
    if (!next && running) {
      details?.cancel()

      return
    }

    if (!next) {
      setSeenRun(run)
    }

    onOpenChange(next)
  }

  function afterOpenChange(nowOpen: boolean) {
    if (!nowOpen && phase === 'ended') {
      aiDraft.reset()
    }
  }

  const reviewOpen = draft.aiReview !== null

  return (
    <div className="flex items-center gap-2">
      <p role="status" className="sr-only">
        {!open && isEnded(run) && run !== seenRun ? outcomeDescription(run) : ''}
      </p>
      {!(phase === 'choosing' && reviewOpen) && (
        <ToolbarAction
          icon={action.icon}
          label={action.label}
          render={<Button ref={actionRef} variant="outline" onClick={() => changeOpen(true)} />}
        />
      )}
      <Dialog
        disablePointerDismissal={running}
        open={open}
        onOpenChange={changeOpen}
        onOpenChangeComplete={afterOpenChange}>
        <DialogContent
          closeLabel={t('closeDialog')}
          finalFocus={() => (reviewOpen ? reviewTriggerRef.current : actionRef.current)}
          initialFocus={{ choosing: true, running: stopRef, ended: outcomeRef }[phase]}
          showCloseButton={!running}
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <AiDraftDialogBody
            aiDraft={aiDraft}
            draft={draft}
            outcomeRef={outcomeRef}
            sampleRef={sampleRef}
            stopRef={stopRef}
            onClose={() => changeOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
