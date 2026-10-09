import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { SettingsScreen } from '@/components/settings/settings-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { currentWorkspaceEndpoint } from '@edi-bridge/contracts'
import { createWorkspace, seedWorkspace, workspaceHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Settings/SettingsScreen',
  component: SettingsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...workspaceHandlers(apiUrl, seedWorkspace))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toHaveValue(seedWorkspace.gln)
  },
})

export const WithoutGln = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...workspaceHandlers(apiUrl, createWorkspace({ name: 'Ostsee Feinkost AG', gln: null })),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/Your company has no GLN yet/)).toBeVisible()
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
    await expect(canvas.getByText('Loading settings')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Settings unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Unternehmensidentität' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toBeVisible()
  },
})
