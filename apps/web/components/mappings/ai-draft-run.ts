import type { AiDraftEvent, AiDraftFailureReason, AiDraftStep } from '@edi-bridge/contracts'

export type AiDraftProblem = AiDraftFailureReason | 'reviewOpen' | 'interrupted'

export type AiDraftRun =
  | { status: 'idle' }
  | { status: 'running'; steps: AiDraftStep[] }
  | { status: 'drafted'; steps: AiDraftStep[]; linkCount: number; transformCount: number }
  | { status: 'empty'; steps: AiDraftStep[] }
  | { status: 'failed'; steps: AiDraftStep[]; problem: AiDraftProblem }

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

export function roundsOf(run: AiDraftRun) {
  return Math.max(0, ...stepsOf(run).map(({ round }) => round))
}

export type AiDraftStepState = 'done' | 'current' | 'stopped'

export type AiDraftRound = {
  round: number
  steps: Array<{ step: AiDraftStep; state: AiDraftStepState }>
}

// The last step is still at work while the run goes on; a failed run stopped at it.
const lastStepStates = {
  idle: 'done',
  running: 'current',
  drafted: 'done',
  empty: 'done',
  failed: 'stopped',
} as const satisfies Record<AiDraftRun['status'], AiDraftStepState>

export function progressRounds(run: AiDraftRun): AiDraftRound[] {
  const steps = stepsOf(run)
  const lastState = lastStepStates[run.status]
  const rounds: AiDraftRound[] = []

  steps.forEach((step, index) => {
    const state = index === steps.length - 1 ? lastState : 'done'
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
