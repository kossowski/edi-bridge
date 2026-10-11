import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { expect, waitFor } from 'storybook/test'

import { SessionGate } from '@/components/session/session-gate'
import { apiUrl } from '@/lib/api/config'
import { sessionEndpoint } from '@edi-bridge/contracts'
import { createSessionStore, sessionHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Session/SessionGate',
  component: SessionGate,
  args: { children: <p>Workspace content</p> },
})

export const SignedIn = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText('Workspace content')).toBeVisible()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const SignedOut = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(null)))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('status')).toHaveTextContent('Your session has ended.')
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})

export const SessionUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${sessionEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Workspace content')).toBeVisible()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})
