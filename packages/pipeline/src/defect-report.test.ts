import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { DefectReporter, reportDefect } from './defect-report'

const ids = {
  workspaceId: 'workspace',
  runId: 'run',
  tradingPartnerId: null,
  channelId: null,
  code: 'processingDefect',
} as const

describe('the report of a defect', () => {
  it('gives up on a reporter that hangs, so the worker job goes on', async () => {
    const reported = await Effect.runPromise(
      Effect.gen(function* () {
        const reporting = yield* Effect.forkChild(reportDefect(ids, new Error('Stuck')))

        yield* TestClock.adjust('5 seconds')

        return yield* Fiber.join(reporting)
      }).pipe(
        Effect.provideService(DefectReporter, { report: () => Effect.never }),
        Effect.provide(TestClock.layer()),
      ),
    )

    expect(reported).toBeUndefined()
  })
})
