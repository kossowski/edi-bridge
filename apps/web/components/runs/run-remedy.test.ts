import { describe, expect, it } from 'vitest'

import { runRemedy } from './run-remedy'

const replacement = { id: '00000000-0000-4000-8000-000000000002' }

describe('runRemedy', () => {
  it.each([
    ['inbound', 'delivery', 'retry'],
    ['outbound', 'delivery', 'retry'],
    ['inbound', 'mapping', 'reprocess'],
    ['outbound', 'mapping', 'reprocess'],
    ['inbound', 'parse', 'awaitingResend'],
    ['inbound', 'validation', 'awaitingResend'],
    ['outbound', 'validation', 'none'],
  ] as const)('offers a %s Run that failed at %s: %s', (direction, failureStage, remedy) => {
    expect(runRemedy({ status: 'failed', failureStage, direction, replacedBy: null })).toBe(remedy)
  })

  it.each(['received', 'processing', 'delivered', 'duplicate'] as const)(
    'offers nothing for a %s Run',
    (status) => {
      expect(
        runRemedy({ status, failureStage: null, direction: 'inbound', replacedBy: null }),
      ).toBe('none')
    },
  )

  it('offers nothing for a failed Run that another Run already replaced', () => {
    expect(
      runRemedy({
        status: 'failed',
        failureStage: 'mapping',
        direction: 'inbound',
        replacedBy: replacement,
      }),
    ).toBe('replaced')
  })
})
