import { firstSearchParam } from '@/lib/search-params'
import {
  type AiBudget,
  aiBudgetExhausted,
  type AiDraftEvent,
  type AiDraftFailureReason,
  type AiDraftStep,
} from '@edi-bridge/contracts'

export type AiDraftProblem = AiDraftFailureReason | 'reviewOpen' | 'interrupted' | 'stopped'

export type AiDraftRun =
  | { status: 'idle' }
  | { status: 'running'; steps: AiDraftStep[] }
  | { status: 'drafted'; steps: AiDraftStep[]; linkCount: number; transformCount: number }
  | { status: 'empty'; steps: AiDraftStep[] }
  | { status: 'failed'; steps: AiDraftStep[]; problem: AiDraftProblem }

export type EndedAiDraftRun = Extract<AiDraftRun, { status: 'drafted' | 'empty' | 'failed' }>

export type AiDraftOutcome = 'drafted' | 'empty' | AiDraftProblem

const aiDraftParam = 'ai-draft'

export const aiDraftStartQuery = { [aiDraftParam]: 'start' } as const

export const aiDraftStartHref = (mappingId: string) =>
  `/mappings/${mappingId}?${new URLSearchParams(aiDraftStartQuery)}`

export function aiDraftRequestedIn(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
) {
  return firstSearchParam(searchParams[aiDraftParam]) === aiDraftStartQuery[aiDraftParam]
}

export function hrefWithoutAiDraftStart(pathname: string, params: URLSearchParams, hash = '') {
  const kept = new URLSearchParams(params)

  kept.delete(aiDraftParam)

  const search = kept.toString()

  return `${pathname}${search ? `?${search}` : ''}${hash}`
}

export function isAiDraftAvailable({
  canChange,
  desktop,
  reviewOpen,
}: {
  canChange: boolean
  desktop: boolean
  reviewOpen: boolean
}) {
  return canChange && desktop && !reviewOpen
}

export const idleRun: AiDraftRun = { status: 'idle' }

export const startedRun: AiDraftRun = { status: 'running', steps: [] }

const stepsOf = (run: AiDraftRun) => (run.status === 'idle' ? [] : run.steps)

export function runAfterEvent(run: AiDraftRun, event: AiDraftEvent): AiDraftRun {
  if (run.status !== 'running') {
    return run
  }

  switch (event.type) {
    case 'step':
      return { status: 'running', steps: [...run.steps, event.step] }

    case 'drafted': {
      const { links, transforms, transformLinks } = event.proposal
      const linkCount = links.length + transformLinks.length

      return linkCount + transforms.length === 0
        ? { status: 'empty', steps: run.steps }
        : { status: 'drafted', steps: run.steps, linkCount, transformCount: transforms.length }
    }

    case 'failed':
      return { status: 'failed', steps: run.steps, problem: event.reason }
  }
}

export function runAfterProblem(run: AiDraftRun, problem: AiDraftProblem): AiDraftRun {
  return run.status === 'running' ? { status: 'failed', steps: stepsOf(run), problem } : run
}

export function lastRound(run: AiDraftRun) {
  return Math.max(0, ...stepsOf(run).map(({ round }) => round))
}

export type AiDraftStepState = 'done' | 'current' | 'stopped'

export type AiDraftPhase = 'choosing' | 'running' | 'ended'

const presentations = {
  idle: { phase: 'choosing', lastStepState: 'done', tone: 'neutral' },
  running: { phase: 'running', lastStepState: 'current', tone: 'neutral' },
  drafted: { phase: 'ended', lastStepState: 'done', tone: 'success' },
  empty: { phase: 'ended', lastStepState: 'done', tone: 'neutral' },
  failed: { phase: 'ended', lastStepState: 'stopped', tone: 'failed' },
} as const satisfies Record<
  AiDraftRun['status'],
  {
    phase: AiDraftPhase
    lastStepState: AiDraftStepState
    tone: 'neutral' | 'success' | 'failed'
  }
>

const retryable: Readonly<Record<AiDraftOutcome, boolean>> = {
  drafted: false,
  empty: true,
  checkFailed: true,
  unavailable: true,
  interrupted: true,
  stopped: true,
  budgetExhausted: false,
  reviewOpen: false,
}

export function runPresentation(run: AiDraftRun) {
  return presentations[run.status]
}

export function isEnded(run: AiDraftRun): run is EndedAiDraftRun {
  return runPresentation(run).phase === 'ended'
}

export function outcomeKey(run: EndedAiDraftRun): AiDraftOutcome {
  return run.status === 'failed' ? run.problem : run.status
}

export function canRetry(run: AiDraftRun) {
  return isEnded(run) && retryable[outcomeKey(run)]
}

export type AiDraftRound = {
  round: number
  steps: Array<{ step: AiDraftStep; state: AiDraftStepState }>
}

export function progressRounds(run: AiDraftRun): AiDraftRound[] {
  const steps = stepsOf(run)
  const { lastStepState } = runPresentation(run)
  const rounds: AiDraftRound[] = []

  steps.forEach((step, index) => {
    const state = index === steps.length - 1 ? lastStepState : 'done'
    const current = rounds.at(-1)

    if (current?.round === step.round) {
      current.steps.push({ step, state })
    } else {
      rounds.push({ round: step.round, steps: [{ step, state }] })
    }
  })

  return rounds
}

export function shownSegmentTags(tags: ReadonlyArray<string>, max = 6) {
  return tags.length <= max
    ? { shown: tags, more: 0 }
    : { shown: tags.slice(0, max - 1), more: tags.length - (max - 1) }
}

export function budgetBlocksStart(budget: AiBudget) {
  return budget.dailyLimit === 0 || aiBudgetExhausted(budget)
}

export function chosenSampleId(
  chosen: string | null,
  samples: ReadonlyArray<{ id: string }> | undefined,
) {
  return chosen ?? samples?.[0]?.id ?? null
}

export function autoStartSampleId(
  samples: ReadonlyArray<{ id: string }> | undefined,
  budget: AiBudget | undefined,
) {
  return budget && !budgetBlocksStart(budget) ? chosenSampleId(null, samples) : null
}
