import { describe, expect, it } from 'vitest'

import {
  aiProposalFor,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  toMappingDraft,
  withAiProposal,
} from '@edi-bridge/mocks'

import type { AiDraftEvent, AiDraftStep, AiProposal } from '@edi-bridge/contracts'

import {
  type AiDraftRun,
  budgetBlocksStart,
  canRetry,
  chosenSampleId,
  idleRun,
  isEnded,
  lastRound,
  outcomeKey,
  progressRounds,
  runAfterEvent,
  runAfterProblem,
  shownSegmentTags,
  startedRun,
} from './ai-draft-run'

const record = seedMappingDrafts.find(
  ({ id, links, transforms }) =>
    links.length === 0 &&
    transforms.length === 0 &&
    seedMappingSamples.some(({ mappingId }) => mappingId === id),
)!

const sample = seedMappingSamples.find(({ mappingId }) => mappingId === record.id)!

function draftedEvent(proposal: AiProposal): AiDraftEvent {
  return {
    type: 'drafted',
    proposal,
    draft: toMappingDraft(withAiProposal(record, sample.id, proposal), seedDocumentStructures),
  }
}

const steps: AiDraftStep[] = [
  { kind: 'readingSample', round: 1 },
  { kind: 'linksDrafted', round: 1, linkCount: 4 },
  { kind: 'checkingAgainstSample', round: 1 },
  { kind: 'fixingErrors', round: 1, errorCount: 3 },
  { kind: 'linksDrafted', round: 2, linkCount: 3 },
]

const running = (taken: AiDraftStep[]) =>
  taken.reduce<AiDraftRun>((run, step) => runAfterEvent(run, { type: 'step', step }), startedRun)

describe('runAfterEvent', () => {
  it('collects the steps while the run goes on', () => {
    expect(running(steps)).toEqual({ status: 'running', steps })
  })

  it('counts the links and transforms of a drafted proposal', () => {
    const proposal = aiProposalFor(record, seedDocumentStructures)

    expect(runAfterEvent(running(steps), draftedEvent(proposal))).toEqual({
      status: 'drafted',
      steps,
      linkCount: proposal.links.length + proposal.transformLinks.length,
      transformCount: proposal.transforms.length,
    })
  })

  it('ends empty when the proposal holds nothing', () => {
    const proposal = { links: [], transforms: [], transformLinks: [] }

    expect(runAfterEvent(running(steps), draftedEvent(proposal))).toEqual({
      status: 'empty',
      steps,
    })
  })

  it('ends failed with the reason of the failed event', () => {
    expect(runAfterEvent(running(steps), { type: 'failed', reason: 'checkFailed' })).toEqual({
      status: 'failed',
      steps,
      problem: 'checkFailed',
    })
  })

  it('ignores events once the run is over or before it started', () => {
    const failed = runAfterProblem(running(steps), 'interrupted')
    const step = { type: 'step', step: steps[0]! } as const

    expect(runAfterEvent(failed, step)).toBe(failed)
    expect(runAfterEvent(idleRun, step)).toBe(idleRun)
  })
})

describe('runAfterProblem', () => {
  it('fails a running run and leaves an ended one alone', () => {
    expect(runAfterProblem(startedRun, 'reviewOpen')).toEqual({
      status: 'failed',
      steps: [],
      problem: 'reviewOpen',
    })
    expect(runAfterProblem(idleRun, 'interrupted')).toBe(idleRun)
  })
})

describe('progressRounds', () => {
  it('groups the steps by round and marks the last one as at work', () => {
    expect(progressRounds(running(steps))).toEqual([
      {
        round: 1,
        steps: steps.slice(0, 4).map((step) => ({ step, state: 'done' })),
      },
      { round: 2, steps: [{ step: steps[4], state: 'current' }] },
    ])
  })

  it('marks the last step as stopped when the run failed', () => {
    const rounds = progressRounds(runAfterProblem(running(steps), 'unavailable'))

    expect(rounds.at(-1)?.steps.at(-1)?.state).toBe('stopped')
  })

  it('marks every step as done when the run drafted', () => {
    const run = runAfterEvent(
      running(steps),
      draftedEvent(aiProposalFor(record, seedDocumentStructures)),
    )

    expect(
      progressRounds(run)
        .flatMap((round) => round.steps)
        .every(({ state }) => state === 'done'),
    ).toBe(true)
  })

  it('has no rounds before the first step', () => {
    expect(progressRounds(startedRun)).toEqual([])
    expect(progressRounds(idleRun)).toEqual([])
  })
})

describe('lastRound', () => {
  it('is the highest round the run reached', () => {
    expect(lastRound(running(steps))).toBe(2)
    expect(lastRound(startedRun)).toBe(0)
  })
})

describe('outcomeKey', () => {
  it('is the problem of a failed run and the status otherwise', () => {
    const empty = runAfterEvent(
      running(steps),
      draftedEvent({ links: [], transforms: [], transformLinks: [] }),
    )

    const stopped = runAfterProblem(running(steps), 'stopped')

    expect(isEnded(empty) && outcomeKey(empty)).toBe('empty')
    expect(isEnded(stopped) && outcomeKey(stopped)).toBe('stopped')
  })
})

describe('canRetry', () => {
  it('offers a retry after problems another attempt can fix', () => {
    expect(canRetry(runAfterProblem(running(steps), 'stopped'))).toBe(true)
    expect(canRetry(runAfterProblem(running(steps), 'checkFailed'))).toBe(true)
  })

  it('offers no retry after a drafted run, a used-up budget or an open review', () => {
    const drafted = runAfterEvent(
      running(steps),
      draftedEvent(aiProposalFor(record, seedDocumentStructures)),
    )

    expect(canRetry(drafted)).toBe(false)
    expect(canRetry(runAfterProblem(running(steps), 'budgetExhausted'))).toBe(false)
    expect(canRetry(runAfterProblem(running(steps), 'reviewOpen'))).toBe(false)
  })

  it('offers no retry before the run ended', () => {
    expect(canRetry(idleRun)).toBe(false)
    expect(canRetry(running(steps))).toBe(false)
  })
})

describe('budgetBlocksStart', () => {
  const resetsAt = '2026-10-12T00:00:00.000Z'

  it('blocks a start when the budget is used up or turned off', () => {
    expect(budgetBlocksStart({ dailyLimit: 1000, usedToday: 1000, resetsAt })).toBe(true)
    expect(budgetBlocksStart({ dailyLimit: 0, usedToday: 0, resetsAt })).toBe(true)
  })

  it('lets a start through while tokens are left', () => {
    expect(budgetBlocksStart({ dailyLimit: 1000, usedToday: 999, resetsAt })).toBe(false)
  })
})

describe('chosenSampleId', () => {
  const samples = [{ id: 'first' }, { id: 'second' }]

  it('defaults to the first Sample Document', () => {
    expect(chosenSampleId(null, samples)).toBe('first')
  })

  it('keeps the chosen Sample Document', () => {
    expect(chosenSampleId('second', samples)).toBe('second')
  })

  it('has none without Sample Documents', () => {
    expect(chosenSampleId(null, [])).toBeNull()
    expect(chosenSampleId(null, undefined)).toBeNull()
  })
})

describe('shownSegmentTags', () => {
  it('shows every tag up to the limit', () => {
    expect(shownSegmentTags(['BGM', 'DTM'], 3)).toEqual({ shown: ['BGM', 'DTM'], more: 0 })
  })

  it('counts the tags beyond the limit', () => {
    expect(shownSegmentTags(['BGM', 'DTM', 'NAD', 'LIN'], 3)).toEqual({
      shown: ['BGM', 'DTM'],
      more: 2,
    })
  })
})
