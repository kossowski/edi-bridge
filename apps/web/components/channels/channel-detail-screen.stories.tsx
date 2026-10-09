import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { ChannelDetailScreen } from '@/components/channels/channel-detail-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { channelEndpoint, regenerateWebhookTokenEndpoint } from '@edi-bridge/contracts'
import { createHandlers, seedChannels } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const sftpInbox = seeded('Hansemarkt SFTP inbox')

const sftpOutbox = seeded('Hansemarkt SFTP outbox')

const webhook = seeded('ERP webhook')

const httpDelivery = seeded('ERP HTTP delivery')

const webhookToken = webhook.type === 'webhook' ? webhook.token : ''

const meta = preview.meta({
  title: 'Channels/ChannelDetailScreen',
  component: ChannelDetailScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const InboundSftp = meta.story({
  args: { id: sftpInbox.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt SFTP inbox' }),
    ).toBeVisible()
    await expect(canvas.getByText('Polled folder')).toBeVisible()
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(canvas.queryByText(/whk_/)).toBeNull()
  },
})

export const OutboundSftp = meta.story({
  args: { id: sftpOutbox.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Upload folder')).toBeVisible()
    await expect(canvas.queryByText('Polling interval')).toBeNull()
  },
})

export const InboundWebhook = meta.story({
  args: { id: webhook.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Webhook' })).toBeVisible()
    await expect(canvas.getByText(/^https?:\/\/.*\/webhooks\//)).toBeVisible()
    await expect(canvas.getByText('Authorization: Bearer whk_…')).toBeVisible()
    await expect(canvas.getByText(`Ends in ${webhookToken.slice(-4)}`)).toBeInTheDocument()
  },
})

export const RegenerateWebhookToken = meta.story({
  args: { id: webhook.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Regenerate token' }))
    await expect(canvas.getByText(/The current token stops working/)).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Regenerate token now' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Copy the webhook token now' })).toHaveFocus(),
    )
    await expect(canvas.getByText(/^whk_[A-Za-z0-9]{32}$/)).toBeVisible()
  },
})

export const RegenerateFails = meta.story({
  args: { id: webhook.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${regenerateWebhookTokenEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Regenerate token' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Regenerate token now' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The token could not be regenerated.',
    )
  },
})

export const OutboundHttp = meta.story({
  args: { id: httpDelivery.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Authorization header')).toBeVisible()
    await expect(canvas.getByText('Set')).toBeVisible()
    await expect(canvas.getAllByText('Own systems')[0]).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '10000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Channel not found')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { id: sftpInbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Channel')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: sftpInbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Channel unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: webhook.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Token neu erzeugen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: webhook.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Regenerate token' }))
    await expect(canvas.getByText(/The current token stops working/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Regenerate token now' }))
    await expect(
      await canvas.findByRole('heading', { name: 'Copy the webhook token now' }),
    ).toBeVisible()
  },
})
