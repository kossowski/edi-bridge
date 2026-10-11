import { expect } from 'storybook/test'

import { CanChangeOnly } from '@/components/session/can-change-only'
import { sessionHandlers, viewerStory } from '@/components/session/session-story-helpers'
import { sandboxAdminSession } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Session/CanChangeOnly',
  component: CanChangeOnly,
  args: { children: <p>New Trading Partner form</p> },
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('New Trading Partner form')).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(canvas.getByRole('heading', { name: 'Page not found' })).toBeVisible()
      await expect(canvas.queryByText('New Trading Partner form')).toBeNull()
    },
  }),
})
