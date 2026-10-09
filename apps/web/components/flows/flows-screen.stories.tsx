import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { FlowsScreen } from '@/components/flows/flows-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { flowsEndpoint } from '@edi-bridge/contracts'
import { createFlows, createHandlers, flowHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Flows/FlowsScreen',
  component: FlowsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    const link = await canvas.findByRole('link', { name: 'Hansemarkt DESADV outbound' })
    const row = within(link.closest('tr')!)

    await expect(await row.findByText('ERP webhook')).toBeVisible()
    await expect(row.getByText('Hansemarkt SFTP outbox')).toBeVisible()
    await expect(row.getByText('Version 3')).toBeVisible()
    await expect(row.getByText('Newer version available')).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...flowHandlers(apiUrl, { flows: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Flows yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${flowsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Flows')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${flowsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Flows unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...flowHandlers(apiUrl, { flows: createFlows({ count: 400 }) }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('400 Flows')).toBeVisible()
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
      await canvas.findByRole('link', { name: 'Hansemarkt ORDERS inbound' }),
    ).toBeVisible()
    await expect(canvas.getAllByText('Neuere Version verfügbar')[0]).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Hansemarkt ORDERS inbound' }),
    ).toBeVisible()
  },
})
