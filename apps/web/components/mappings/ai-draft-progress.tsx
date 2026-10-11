'use client'

import { Alert02Icon, Loading03Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  type AiDraftRound,
  type AiDraftRun,
  type AiDraftStepState,
  progressRounds,
  shownSegmentTags,
} from '@/components/mappings/ai-draft-run'

import type { AiDraftStep } from '@edi-bridge/contracts'

export function StepIcon({ state }: { state: AiDraftStepState }) {
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

export function useStepText() {
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

export function AiDraftProgress({ run }: { run: AiDraftRun }) {
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
