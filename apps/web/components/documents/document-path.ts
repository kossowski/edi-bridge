import type { RunDetail, RunStepStage, RunStepStatus } from '@edi-bridge/contracts'

export const pathStepKeys = {
  receipt: 'received',
  parse: 'read',
  validation: 'checked',
  mapping: 'translated',
  delivery: 'delivered',
} as const satisfies Record<RunStepStage, string>

export type PathStepKey = (typeof pathStepKeys)[RunStepStage]

export type PathStepState = 'done' | 'failed' | 'running' | 'pending' | 'skipped' | 'notReached'

export type PathStep = { key: PathStepKey; stage: RunStepStage; state: PathStepState }

function stateOf(status: RunStepStatus, failed: boolean): PathStepState {
  switch (status) {
    case 'succeeded': {
      return 'done'
    }

    case 'skipped': {
      return failed ? 'notReached' : 'skipped'
    }

    default: {
      return status
    }
  }
}

export function documentPath(run: Pick<RunDetail, 'status' | 'steps'>): PathStep[] {
  return run.steps.map(({ stage, status }) => ({
    key: pathStepKeys[stage],
    stage,
    state: stateOf(status, run.status === 'failed'),
  }))
}
