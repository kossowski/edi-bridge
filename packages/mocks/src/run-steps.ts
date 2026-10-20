import {
  directionOf,
  type FailureStage,
  type MappingVersionSummary,
  type RunStatus,
  type RunStepStage,
  type RunStepStatus,
  type RunSummary,
} from '@edi-bridge/contracts'

import { mappingVersionsForFlow } from './flow'
import { seededFaker } from './seeded-faker'

export type RunOutcome =
  | { status: 'failed'; failureStage: FailureStage }
  | { status: Exclude<RunStatus, 'failed'>; failureStage: null }

type StepRun = Pick<RunSummary, 'id' | 'messageType'> & RunOutcome

export function stagesOf(run: Pick<RunSummary, 'messageType'>): RunStepStage[] {
  return directionOf(run) === 'outbound'
    ? ['receipt', 'mapping', 'validation', 'delivery']
    : ['receipt', 'parse', 'validation', 'mapping', 'delivery']
}

export function stepStatuses(run: StepRun): RunStepStatus[] {
  const stages = stagesOf(run)

  switch (run.status) {
    case 'delivered': {
      return stages.map(() => 'succeeded')
    }

    case 'failed': {
      const failed = stages.indexOf(run.failureStage)

      return stages.map((_, index) =>
        index < failed ? 'succeeded' : index === failed ? 'failed' : 'skipped',
      )
    }

    case 'processing': {
      const running = seededFaker(`steps:${run.id}`).number.int({ min: 1, max: stages.length - 1 })

      return stages.map((_, index) =>
        index < running ? 'succeeded' : index === running ? 'running' : 'pending',
      )
    }

    case 'received': {
      return stages.map((_, index) => (index === 0 ? 'succeeded' : 'pending'))
    }

    case 'duplicate': {
      // An inbound Duplicate is detected from the UNB envelope, so it gets through parsing first.
      const detectedAt = directionOf(run) === 'inbound' ? 1 : 0

      return stages.map((_, index) => (index <= detectedAt ? 'succeeded' : 'skipped'))
    }
  }
}

export function statusOf(run: StepRun, stage: RunStepStage) {
  return stepStatuses(run)[stagesOf(run).indexOf(stage)]
}

// Like the api, which records the version when it claims a Run, before parsing.
export function recordedMappingVersionOf(run: RunSummary): MappingVersionSummary | null {
  if (run.status === 'received') {
    return null
  }

  const receivedAt = Date.parse(run.receivedAt)
  const versions = mappingVersionsForFlow(run)

  return (
    versions.find(({ publishedAt }) => Date.parse(publishedAt) <= receivedAt) ??
    // SAFETY: every Flow's Mapping has at least one version, so the oldest one exists.
    versions.at(-1)!
  )
}
