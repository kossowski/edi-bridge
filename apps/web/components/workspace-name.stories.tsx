import { delay, http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'

import { WorkspaceName } from '@/components/workspace-name'
import { apiUrl } from '@/lib/api/config'
import { currentWorkspaceEndpoint } from '@edi-bridge/contracts'
import { createWorkspace, currentWorkspaceHandler } from '@edi-bridge/mocks'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Shell/WorkspaceName',
  component: WorkspaceName,
})

export const Loaded = meta.story({
  beforeEach({ msw }) {
    msw.use(currentWorkspaceHandler(apiUrl, createWorkspace({ name: 'Ostsee Feinkost AG' })))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Ostsee Feinkost AG')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${currentWorkspaceEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Workspace')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${currentWorkspaceEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Workspace unavailable')).toBeVisible()
  },
})
