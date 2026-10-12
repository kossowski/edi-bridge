import { FailureStageLabel, RunStatusBadge } from '@/components/documents/run-status'
import { darkMode, german } from '@/components/story-helpers'
import { failureStages, runStatuses } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

function RunStatusOverview() {
  return (
    <div className="bg-background text-foreground flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        {runStatuses.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {failureStages.map((stage) => (
          <FailureStageLabel key={stage} failureStage={stage} />
        ))}
      </div>
    </div>
  )
}

const meta = preview.meta({
  title: 'Documents/RunStatus',
  component: RunStatusOverview,
})

export const Light = meta.story({})

export const Dark = meta.story({ beforeEach: darkMode })

export const German = meta.story({ decorators: [german] })
