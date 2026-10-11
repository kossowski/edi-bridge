import { expect } from 'storybook/test'

import { OperatorOnly } from '@/components/session/operator-only'
import { apiUrl } from '@/lib/api/config'
import {
  createSessionStore,
  sandboxAdminSession,
  seedSession,
  sessionHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Session/OperatorOnly',
  component: OperatorOnly,
  args: { children: <p>Operator area</p> },
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(seedSession)))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Operator area')).toBeVisible()
  },
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(sandboxAdminSession)))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(canvas.queryByText('Operator area')).toBeNull()
  },
})
