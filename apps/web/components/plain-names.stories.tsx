import { expect } from 'storybook/test'

import { FailureStageLabel, RunStatusBadge } from '@/components/documents/run-status'
import { MessageTypeName, usePlainNames } from '@/components/plain-names'
import { darkMode, german } from '@/components/story-helpers'
import { failureStages, messageTypes, runStatuses } from '@edi-bridge/contracts'

import preview from '../.storybook/preview'

function PlainNamesOverview() {
  const plainNames = usePlainNames()

  return (
    <div className="bg-background text-foreground flex flex-col gap-6 p-4 text-sm">
      <ul className="flex flex-col gap-1">
        {messageTypes.map((messageType) => (
          <li key={messageType} className="flex flex-wrap gap-x-6">
            <MessageTypeName messageType={messageType} />
            <MessageTypeName messageType={messageType} plural />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {runStatuses.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </div>
      <dl className="flex max-w-prose flex-col gap-3">
        {failureStages.map((stage) => (
          <div key={stage} className="flex flex-col gap-0.5">
            <dt className="font-medium">
              <FailureStageLabel failureStage={stage} />
            </dt>
            <dd className="text-muted-foreground">{plainNames.failureStageSummary(stage)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const meta = preview.meta({
  title: 'Shared/PlainNames',
  component: PlainNamesOverview,
})

export const Light = meta.story({
  async play({ canvas }) {
    await expect(canvas.getByText('Purchase order')).toBeVisible()
    await expect(canvas.getAllByText('ORDERS')).toHaveLength(2)
    await expect(canvas.getByText('Needs attention')).toBeVisible()
    await expect(canvas.getByText('The file could not be read')).toBeVisible()
    await expect(canvas.getByText('Duplicate')).toBeVisible()
  },
})

export const Dark = meta.story({ beforeEach: darkMode })

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(canvas.getByText('Bestellung')).toBeVisible()
    await expect(canvas.getByText('Handlungsbedarf')).toBeVisible()
    await expect(canvas.getByText('Duplikat')).toBeVisible()
    await expect(canvas.getByText('Die Datei konnte nicht gelesen werden')).toBeVisible()
  },
})
