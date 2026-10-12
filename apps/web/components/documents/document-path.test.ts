import { describe, expect, it } from 'vitest'

import type { RunDetail, RunStepStage, RunStepStatus } from '@edi-bridge/contracts'

import { documentPath } from './document-path'

function run(status: RunDetail['status'], statuses: Array<[RunStepStage, RunStepStatus]>) {
  return {
    status,
    steps: statuses.map(([stage, stepStatus]) => ({
      stage,
      status: stepStatus,
      startedAt: null,
      finishedAt: null,
    })),
  }
}

describe('documentPath', () => {
  it('names each stage as a step of the path', () => {
    const path = documentPath(
      run('delivered', [
        ['receipt', 'succeeded'],
        ['parse', 'succeeded'],
        ['validation', 'succeeded'],
        ['mapping', 'succeeded'],
        ['delivery', 'succeeded'],
      ]),
    )

    expect(path.map(({ key }) => key)).toEqual([
      'received',
      'read',
      'checked',
      'translated',
      'delivered',
    ])
    expect(path.every(({ state }) => state === 'done')).toBe(true)
  })

  it('keeps the order of an outbound path', () => {
    const path = documentPath(
      run('delivered', [
        ['receipt', 'succeeded'],
        ['mapping', 'succeeded'],
        ['validation', 'succeeded'],
        ['delivery', 'succeeded'],
      ]),
    )

    expect(path.map(({ key }) => key)).toEqual(['received', 'translated', 'checked', 'delivered'])
  })

  it('marks the failed step and the steps after it as not reached', () => {
    const path = documentPath(
      run('failed', [
        ['receipt', 'succeeded'],
        ['parse', 'succeeded'],
        ['validation', 'failed'],
        ['mapping', 'skipped'],
        ['delivery', 'skipped'],
      ]),
    )

    expect(path.map(({ state }) => state)).toEqual([
      'done',
      'done',
      'failed',
      'notReached',
      'notReached',
    ])
  })

  it('keeps skipped steps of a duplicate as skipped', () => {
    const path = documentPath(
      run('duplicate', [
        ['receipt', 'succeeded'],
        ['mapping', 'skipped'],
        ['validation', 'skipped'],
        ['delivery', 'skipped'],
      ]),
    )

    expect(path.map(({ state }) => state)).toEqual(['done', 'skipped', 'skipped', 'skipped'])
  })

  it('shows a document in progress with its running and pending steps', () => {
    const path = documentPath(
      run('processing', [
        ['receipt', 'succeeded'],
        ['parse', 'running'],
        ['validation', 'pending'],
      ]),
    )

    expect(path.map(({ state }) => state)).toEqual(['done', 'running', 'pending'])
  })
})
