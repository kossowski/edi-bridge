import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
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

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${sessionEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    const status = canvas.getByRole('status')
    await expect(status).toHaveTextContent('Loading session…')
    await expect(status.closest('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByText('Workspace content')).toBeNull()
  },
})

export const SignedOut = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(null)))
  },
  async play({ canvas }) {
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Your session has ended.'),
    )
    await expect(canvas.getByRole('status').closest('[aria-busy="true"]')).not.toBeNull()
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
