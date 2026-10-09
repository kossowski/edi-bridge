import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { ChannelsScreen } from '@/components/channels/channels-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { channelsEndpoint } from '@edi-bridge/contracts'
import { channelHandlers, createChannels, createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Channels/ChannelsScreen',
  component: ChannelsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'ERP webhook' })).toBeVisible()
    await expect(canvas.getAllByText('Own systems')[0]).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Hansemarkt SFTP inbox' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Channels yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Channels')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Channels unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: createChannels({ count: 400 }) }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('400 Channels')).toBeVisible()
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
    await expect(await canvas.findByRole('link', { name: 'ERP webhook' })).toBeVisible()
    await expect(canvas.getAllByText('Eingehender Webhook')[0]).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'ERP webhook' })).toBeVisible()
  },
})
