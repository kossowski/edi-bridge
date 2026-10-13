import { beforeAll, vi } from 'vitest'

import { seedRuns } from './run'
import { workspaceActivityOf } from './workspace-activity'

type SeedRunsBeforeAllOptions = {
  at?: Date
  largeWorkspaceActivity?: boolean
}

// A busy CI runner takes seconds to build the 12,000 seeded and the 30,000 large-volume Runs.
// Built once before the tests, they stay out of the time limit of the first test that reads them.
export function seedRunsBeforeAll({
  at,
  largeWorkspaceActivity = false,
}: SeedRunsBeforeAllOptions = {}) {
  beforeAll(() => {
    if (at) {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(at)
    }

    seedRuns()

    if (largeWorkspaceActivity) {
      workspaceActivityOf('large')
    }

    if (at) {
      vi.useRealTimers()
    }
  }, 30_000)
}
