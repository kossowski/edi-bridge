import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
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
  title: 'Runs/RunStatus',
  component: RunStatusOverview,
})

export const Light = meta.story({})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
})
