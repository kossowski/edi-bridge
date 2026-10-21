import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { ChannelsScreen } from '@/components/channels/channels-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { desktop, mobile, tablet } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { channelsEndpoint } from '@edi-bridge/contracts'
import {
  blockedAddressChannel,
  channelHandlers,
  createChannels,
  createHandlers,
  seedChannels,
} from '@edi-bridge/mocks'

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

// SAFETY: the seed holds Rheinkauf SFTP inbox, the Channel with a stored poll problem.
const pollFailedInbox = seedChannels.find(({ name }) => name === 'Rheinkauf SFTP inbox')!

async function findChannelRow(canvasElement: HTMLElement, name = pollFailedInbox.name) {
  const link = await within(canvasElement).findByRole('link', { name })

  // SAFETY: every Channel name link sits inside the row of its Channel.
  return within(link.closest('tr')!)
}

export const PollProblem = meta.story({
  ...desktop,
  async play({ canvas, canvasElement }) {
    const row = await findChannelRow(canvasElement)

    await expect(row.getByText(/^Polling failed since/)).toBeVisible()
    await expect(row.getByText('The server showed a different key.')).toBeVisible()

    // The fix link waits for the session, which loads apart from the Channels.
    const fix = await row.findByRole('link', {
      name: 'Test the connection, then accept the new key',
    })

    await expect(fix).toBeVisible()
    await expect(fix).toHaveAttribute('href', `/channels/${pollFailedInbox.id}#channel-host-key`)
    await expect(canvas.getAllByText(/^Polling failed since/)).toHaveLength(1)
  },
})

export const PollProblemAddressBlocked = meta.story({
  ...desktop,
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: [blockedAddressChannel] }))
  },
  async play({ canvasElement }) {
    const row = await findChannelRow(canvasElement, blockedAddressChannel.name)

    await expect(row.getByText(/^Polling failed since/)).toBeVisible()
    await expect(
      row.getByText('The server address resolves to the internal address 10.20.0.15.'),
    ).toBeVisible()

    // The fix link waits for the session, which loads apart from the Channels.
    const fix = await row.findByRole('link', { name: 'Change the server address' })

    await expect(fix).toBeVisible()
    await expect(fix).toHaveAttribute('href', `/channels/${blockedAddressChannel.id}/edit`)
  },
})

async function expectOnlyPollingFailed(canvasElement: HTMLElement) {
  const row = await findChannelRow(canvasElement)

  await expect(row.getByText(/^Polling failed since/)).toBeVisible()
  await expect(row.getByText('The server showed a different key.')).not.toBeVisible()
  // Waits for the fix link, rendered once the session loads, before proving it hidden.
  await expect(
    await row.findByText('Test the connection, then accept the new key'),
  ).not.toBeVisible()
}

export const PollProblemMobile = meta.story({
  ...mobile,
  play: ({ canvasElement }) => expectOnlyPollingFailed(canvasElement),
})

export const PollProblemTablet = meta.story({
  ...tablet,
  play: ({ canvasElement }) => expectOnlyPollingFailed(canvasElement),
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No connections yet')).toBeVisible()
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
    await expect(canvas.getByText('Loading connections')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Connections unavailable')).toBeVisible()
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
    await expect(await canvas.findByText('400 connections')).toBeVisible()
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
    await expect(canvas.getByText(/^Abfrage fehlgeschlagen seit/)).toBeVisible()
    await expect(canvas.getByText('14.10.2026, 08:42')).toBeVisible()
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

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('link', { name: 'ERP webhook' })).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'New connection' })).toBeNull()
      await expect(canvas.getByText(/^Polling failed since/)).toBeVisible()
      await expect(
        canvas.queryByRole('link', { name: 'Test the connection, then accept the new key' }),
      ).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...channelHandlers(apiUrl, { channels: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText('Connections appear here once an Admin creates one.'),
      ).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'New connection' })).toBeNull()
    },
  }),
})
