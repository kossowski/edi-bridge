'use client'

import {
  AiMagicIcon,
  Alert02Icon,
  Loading03Icon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  type AiDraftProblem,
  type AiDraftRound,
  type AiDraftRun,
  type AiDraftStepState,
  idleRun,
  progressRounds,
  roundsOf,
  runAfterEvent,
  runAfterProblem,
  shownSegmentTags,
  startedRun,
} from '@/components/mappings/ai-draft-run'
import { useSideTitle } from '@/components/mappings/mapping-side'
import { aiBudgetExhaustedProblemOf, isAiReviewOpen, streamAiDraft } from '@/lib/api/client'
import {
  aiBudgetQuery,
  aiKeys,
  mappingDraftQuery,
  mappingSamplesQuery,
  storeAiBudget,
  storeAiDraftedDraft,
} from '@/lib/api/queries'
import {
  type AiBudget,
  aiBudgetExhausted,
  type AiDraftStep,
  type MappingDraft,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

function useAiDraftRun(mappingId: string) {
  const queryClient = useQueryClient()
  const [run, setRun] = useState<AiDraftRun>(idleRun)
  const controllerRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => stop, [stop])

  function start(sampleId: string) {
    stop()

    const controller = new AbortController()
    controllerRef.current = controller
    setRun(startedRun)

    const update = (next: (run: AiDraftRun) => AiDraftRun) => {
      if (!controller.signal.aborted) {
        setRun(next)
      }
    }

    const failWith = (problem: AiDraftProblem) => update((run) => runAfterProblem(run, problem))

    streamAiDraft(
      mappingId,
      { sampleId },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'drafted') {
            storeAiDraftedDraft(queryClient, event.draft)
          }

          if (event.type !== 'step') {
            void queryClient.invalidateQueries({ queryKey: aiKeys.budget() })
          }

          update((run) => runAfterEvent(run, event))
        },
      },
    ).then(
      () => failWith('interrupted'),
      (error: Error) => {
        const budgetProblem = aiBudgetExhaustedProblemOf(error)

        if (budgetProblem) {
          storeAiBudget(queryClient, budgetProblem.budget)
          failWith('budgetExhausted')
        } else if (isAiReviewOpen(error)) {
          void queryClient.invalidateQueries({ queryKey: mappingDraftQuery(mappingId).queryKey })
          failWith('reviewOpen')
        } else {
          failWith('interrupted')
        }
      },
    )
  }

  function reset() {
    stop()
    setRun(idleRun)
  }

  return { run, start, reset }
}

function StepIcon({ state }: { state: AiDraftStepState }) {
  switch (state) {
    case 'done':
      return (
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2}
          aria-hidden
          className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
        />
      )
    case 'current':
      return (
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-4 shrink-0 motion-safe:animate-spin"
        />
      )
    case 'stopped':
      return (
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={2}
          aria-hidden
          className="size-4 shrink-0 text-red-700 dark:text-red-400"
        />
      )
  }
}

function useStepText() {
  const t = useTranslations('Mapping.aiDraft.step')

  return (step: AiDraftStep) => {
    switch (step.kind) {
      case 'readingSample':
        return t('readingSample')
      case 'lookingUpSegments': {
        const { shown, more } = shownSegmentTags(step.segmentTags)
        const tags = shown.join(', ')

        return more > 0
          ? t('lookingUpManySegments', { tags, count: more })
          : t('lookingUpSegments', { tags })
      }

      case 'linksDrafted':
        return t('linksDrafted', { count: step.linkCount })
      case 'checkingAgainstSample':
        return t('checkingAgainstSample')
      case 'fixingErrors':
        return t('fixingErrors', { count: step.errorCount })
    }
  }
}

function ProgressList({ rounds, labelId }: { rounds: AiDraftRound[]; labelId: string }) {
  const t = useTranslations('Mapping.aiDraft')
  const stepText = useStepText()
  const showRounds = rounds.some(({ round }) => round > 1)

  return (
    <ol aria-labelledby={labelId} className="flex flex-col gap-3">
      {rounds.map(({ round, steps }) => (
        <li key={round} className="flex flex-col gap-1.5">
          {showRounds && (
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t('round', { round })}
            </p>
          )}
          <ol className="flex flex-col gap-1.5">
            {steps.map(({ step, state }, index) => (
              <li
                key={`${step.kind}-${index}`}
                className="data-[state=done]:text-muted-foreground flex items-start gap-2 data-[state=current]:font-medium"
                data-state={state}>
                <span className="flex h-5 items-center">
                  <StepIcon state={state} />
                </span>
                <span>
                  <span className="sr-only">{t(`state.${state}`)}: </span>
                  {stepText(step)}
                </span>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

function Progress({ run }: { run: AiDraftRun }) {
  const t = useTranslations('Mapping.aiDraft')
  const labelId = useId()
  const rounds = progressRounds(run)

  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 id={labelId} className="text-sm font-medium">
        {t('progress')}
      </h3>
      {rounds.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <StepIcon state="current" />
          {t('starting')}
        </p>
      ) : (
        <ProgressList labelId={labelId} rounds={rounds} />
      )}
    </section>
  )
}

const retryable: Readonly<Record<AiDraftProblem | 'drafted' | 'empty', boolean>> = {
  drafted: false,
  empty: true,
  checkFailed: true,
  unavailable: true,
  interrupted: true,
  budgetExhausted: false,
  reviewOpen: false,
}

function Outcome({
  run,
  headingRef,
}: {
  run: Extract<AiDraftRun, { status: 'drafted' | 'empty' | 'failed' }>
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useTranslations('Mapping.aiDraft.outcome')
  const key = run.status === 'failed' ? run.problem : run.status
  const failed = run.status === 'failed'

  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-3 data-[tone=failed]:border-red-700/40 data-[tone=failed]:bg-red-50 data-[tone=success]:border-emerald-700/40 data-[tone=success]:bg-emerald-50 dark:data-[tone=failed]:border-red-400/40 dark:data-[tone=failed]:bg-red-950/40 dark:data-[tone=success]:border-emerald-400/40 dark:data-[tone=success]:bg-emerald-950/40"
      data-tone={failed ? 'failed' : run.status === 'drafted' ? 'success' : 'neutral'}>
      <h3 ref={headingRef} tabIndex={-1} className="font-medium outline-none">
        {t(`${key}.title`)}
      </h3>
      <p>
        {run.status === 'drafted'
          ? t('drafted.description', { links: run.linkCount, transforms: run.transformCount })
          : t(`${key}.description`, { rounds: roundsOf(run) })}
      </p>
    </div>
  )
}

function BudgetNotice({ budget, id }: { budget: AiBudget; id: string }) {
  const t = useTranslations('Mapping.aiDraft.budget')
  const format = useFormatter()

  if (budget.dailyLimit === 0) {
    return (
      <p id={id} className="text-red-800 dark:text-red-300">
        {t('turnedOff')}
      </p>
    )
  }

  if (aiBudgetExhausted(budget)) {
    return (
      <p id={id} className="text-red-800 dark:text-red-300">
        {t('exhausted')}
      </p>
    )
  }

  return (
    <p id={id} className="text-muted-foreground">
      {t('remaining', {
        remaining: format.number(budget.dailyLimit - budget.usedToday),
        limit: format.number(budget.dailyLimit),
      })}
    </p>
  )
}

function Budget({ id }: { id: string }) {
  const t = useTranslations('Mapping.aiDraft.budget')
  const budget = useQuery(aiBudgetQuery)

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{t('label')}</span>
      {budget.isPending ? (
        <>
          <span role="status" className="sr-only">
            {t('loading')}
          </span>
          <Skeleton className="h-5 w-56" />
        </>
      ) : budget.isError ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2">
          {t('error')}
          <Button size="sm" variant="outline" onClick={() => void budget.refetch()}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
            {t('retry')}
          </Button>
        </p>
      ) : (
        <BudgetNotice id={id} budget={budget.data} />
      )}
    </div>
  )
}

function SamplePicker({
  draft,
  chosen,
  onChoose,
  noticeId,
  triggerRef,
}: {
  draft: MappingDraft
  chosen: string | null
  onChoose: (id: string) => void
  noticeId: string
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations('Mapping.aiDraft')
  const samples = useQuery(mappingSamplesQuery(draft.mappingId))
  const labelId = useId()

  if (samples.isPending) {
    return (
      <div className="flex flex-col gap-1.5">
        <span role="status" className="sr-only">
          {t('samples.loading')}
        </span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (samples.isError) {
    return (
      <p id={noticeId} className="flex flex-wrap items-center gap-2 text-red-800 dark:text-red-300">
        {t('samples.error')}
        <Button size="sm" variant="outline" onClick={() => void samples.refetch()}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
          {t('samples.retry')}
        </Button>
      </p>
    )
  }

  if (samples.data.length === 0) {
    return (
      <p id={noticeId} className="text-muted-foreground">
        {t('samples.empty')}
      </p>
    )
  }

  const items = samples.data.map(({ id, name }) => ({ value: id, label: name }))
  const value = chosen ?? items[0]!.value

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="font-medium">
        {t('samples.label')}
      </span>
      <Select items={items} value={value} onValueChange={(next) => next && onChoose(next)}>
        <SelectTrigger ref={triggerRef} aria-labelledby={labelId} className="w-full">
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

function useRequestBlock(draft: MappingDraft, chosen: string | null) {
  const samples = useQuery(mappingSamplesQuery(draft.mappingId))
  const budget = useQuery(aiBudgetQuery)
  const sampleId = chosen ?? samples.data?.[0]?.id ?? null

  const budgetBlocks =
    budget.data !== undefined && (budget.data.dailyLimit === 0 || aiBudgetExhausted(budget.data))

  if (sampleId === null) {
    return { sampleId, blockedBy: 'samples' as const }
  }

  return { sampleId, blockedBy: budgetBlocks ? ('budget' as const) : null }
}

function useStatusText(run: AiDraftRun) {
  const t = useTranslations('Mapping.aiDraft')
  const stepText = useStepText()

  if (run.status === 'idle') {
    return ''
  }

  if (run.status === 'running') {
    const last = run.steps.at(-1)

    return last ? stepText(last) : t('starting')
  }

  const key = run.status === 'failed' ? run.problem : run.status

  return run.status === 'drafted'
    ? t('outcome.drafted.description', { links: run.linkCount, transforms: run.transformCount })
    : t(`outcome.${key}.description`, { rounds: roundsOf(run) })
}

function AiDraftDialogBody({
  draft,
  run,
  onStart,
  onRetry,
  onClose,
}: {
  draft: MappingDraft
  run: AiDraftRun
  onStart: (sampleId: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const t = useTranslations('Mapping.aiDraft')
  const sideTitle = useSideTitle()
  const [chosen, setChosen] = useState<string | null>(null)
  const { sampleId, blockedBy } = useRequestBlock(draft, chosen)
  const budgetId = useId()
  const samplesNoticeId = useId()
  const statusText = useStatusText(run)
  const sampleRef = useRef<HTMLButtonElement>(null)
  const stopRef = useRef<HTMLButtonElement>(null)
  const outcomeRef = useRef<HTMLHeadingElement>(null)
  const previousStatus = useRef(run.status)

  useEffect(() => {
    if (previousStatus.current === run.status) {
      return
    }

    previousStatus.current = run.status

    switch (run.status) {
      case 'idle':
        sampleRef.current?.focus()
        break
      case 'running':
        stopRef.current?.focus()
        break
      default:
        outcomeRef.current?.focus()
    }
  }, [run.status])

  const ended = run.status !== 'idle' && run.status !== 'running'
  const canRetry = ended && retryable[run.status === 'failed' ? run.problem : run.status]

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <p role="status" className="sr-only">
        {statusText}
      </p>
      {run.status === 'idle' ? (
        <div className="flex flex-col gap-4">
          <SamplePicker
            chosen={chosen}
            draft={draft}
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
          <Budget id={budgetId} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Progress run={run} />
          {ended ? (
            <Outcome headingRef={outcomeRef} run={run} />
          ) : (
            <p className="text-muted-foreground">{t('closeStops')}</p>
          )}
        </div>
      )}
      {/* Each slot keeps its button across the states, so focus never drops out of the dialog. */}
      <DialogFooter>
        {(run.status === 'idle' || canRetry) && (
          <Button variant="outline" onClick={run.status === 'idle' ? onClose : onRetry}>
            {run.status !== 'idle' && (
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} aria-hidden />
            )}
            {run.status === 'idle' ? t('cancel') : t('retry')}
          </Button>
        )}
        {run.status === 'idle' ? (
          <Button
            disabled={blockedBy !== null}
            focusableWhenDisabled
            aria-describedby={
              blockedBy ? { budget: budgetId, samples: samplesNoticeId }[blockedBy] : undefined
            }
            onClick={() => sampleId && onStart(sampleId)}>
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />
            {t('start')}
          </Button>
        ) : (
          <Button
            ref={stopRef}
            variant={run.status === 'running' ? 'outline' : 'default'}
            onClick={onClose}>
            {run.status === 'running' ? t('stop') : t('close')}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

export function AiDraftAction({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.aiDraft')
  const [open, setOpen] = useState(false)
  const { run, start, reset } = useAiDraftRun(draft.mappingId)
  const reasonId = useId()

  function changeOpen(next: boolean) {
    reset()
    setOpen(next)
  }

  const reviewOpen = draft.aiReview !== null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {reviewOpen && (
        <span id={reasonId} className="text-muted-foreground text-sm">
          {t('reviewOpen')}
        </span>
      )}
      <Button
        disabled={reviewOpen}
        focusableWhenDisabled
        variant="outline"
        aria-describedby={reviewOpen ? reasonId : undefined}
        onClick={() => changeOpen(true)}>
        <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden />
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          closeLabel={t('closeDialog')}
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
          <AiDraftDialogBody
            draft={draft}
            run={run}
            onClose={() => changeOpen(false)}
            onRetry={reset}
            onStart={start}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
