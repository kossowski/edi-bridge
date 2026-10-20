import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ChannelDetailScreen } from '@/components/channels/channel-detail-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  acceptHostKeyEndpoint,
  channelEndpoint,
  regenerateWebhookTokenEndpoint,
} from '@edi-bridge/contracts'
import { createHandlers, seedChannels, serverHostKey } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const sftpInbox = seeded('Hansemarkt SFTP inbox')

const sftpOutbox = seeded('Hansemarkt SFTP outbox')

const uncheckedInbox = seeded('Alpenfrisch SFTP inbox')

const replacedKeyOutbox = seeded('Rheinkauf SFTP outbox')

const webhook = seeded('ERP webhook')

function hostOf(channel: (typeof seedChannels)[number]) {
  return channel.type === 'sftp' ? channel.host : ''
}

function confirmedKeyOf(channel: (typeof seedChannels)[number]) {
  return channel.type === 'sftp' ? (channel.hostKeyFingerprint ?? '') : ''
}

function hostKeySection(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole('region', { name: 'Host key' }))
}

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
      await canvas.findByRole('heading', { level: 1, name: 'Hansemarkt SFTP inbox' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Polled folder')).toBeVisible()
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(canvas.queryByText(/whk_/)).toBeNull()
  },
})

export const ConfirmedHostKey = meta.story({
  args: { id: sftpInbox.id },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Host key' })
    const section = hostKeySection(canvasElement)
    await expect(section.getByText(confirmedKeyOf(sftpInbox))).toBeVisible()
    await expect(
      section.getByText('EDI Bridge connects only to a server that shows this key.'),
    ).toBeVisible()

    await userEvent.click(section.getByRole('button', { name: /^Test connection/ }))
    await expect(await section.findByText('The server showed the confirmed key.')).toBeVisible()
    await expect(section.getAllByText(confirmedKeyOf(sftpInbox))).toHaveLength(2)
    await expect(section.queryByRole('button', { name: /^Accept/ })).toBeNull()
  },
})

export const UncheckedHostKey = meta.story({
  args: { id: uncheckedInbox.id },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Host key' })
    const section = hostKeySection(canvasElement)
    await expect(section.getByText("The server's key is not checked yet.")).toBeVisible()
    await expect(section.getByText(/paste the key when you edit the connection\.$/)).toBeVisible()

    await userEvent.click(section.getByRole('button', { name: /^Test connection/ }))
    await expect(await section.findByText('The connection works.')).toBeVisible()
    const shown = serverHostKey(hostOf(uncheckedInbox))
    await expect(section.getByText(shown)).toBeVisible()

    await userEvent.click(section.getByRole('button', { name: 'Accept this key' }))
    await expect(
      await section.findByText('Key accepted. EDI Bridge checks it on every connection.'),
    ).toBeVisible()
    await expect(section.queryByText("The server's key is not checked yet.")).toBeNull()
    await expect(
      section.getByText('EDI Bridge connects only to a server that shows this key.'),
    ).toBeVisible()
  },
})

export const MismatchingHostKey = meta.story({
  args: { id: replacedKeyOutbox.id },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Host key' })
    const section = hostKeySection(canvasElement)

    await userEvent.click(section.getByRole('button', { name: /^Test connection/ }))
    await expect(await section.findByText('The server showed a different key.')).toBeVisible()
    const shown = serverHostKey(hostOf(replacedKeyOutbox))
    await expect(section.getByText(shown)).toBeVisible()
    await expect(section.getAllByText(confirmedKeyOf(replacedKeyOutbox))).toHaveLength(2)

    await userEvent.click(section.getByRole('button', { name: 'Accept the new key' }))
    await expect(
      await section.findByText('Key accepted. EDI Bridge checks it on every connection.'),
    ).toBeVisible()
    await expect(section.queryByText('The server showed a different key.')).toBeNull()
    await expect(section.queryByText(confirmedKeyOf(replacedKeyOutbox))).toBeNull()
    await expect(section.getAllByText(shown)[0]).toBeVisible()
  },
})

export const AcceptHostKeyFails = meta.story({
  args: { id: uncheckedInbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${acceptHostKeyEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Host key' })
    const section = hostKeySection(canvasElement)
    await userEvent.click(section.getByRole('button', { name: /^Test connection/ }))
    await userEvent.click(await section.findByRole('button', { name: 'Accept this key' }))
    await expect(await section.findByRole('alert')).toHaveTextContent(
      'The key could not be accepted. Try again.',
    )
  },
})

export const UncheckedHostKeyGerman = meta.story({
  args: { id: uncheckedInbox.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Der Serverschlüssel wird noch nicht geprüft.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Verbindung testen/ }))
    await expect(
      await canvas.findByRole('button', { name: 'Diesen Schlüssel übernehmen' }),
    ).toBeVisible()
  },
})

export const UncheckedHostKeyDark = meta.story({
  args: { id: uncheckedInbox.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: /^Test connection/ }))
    await expect(await canvas.findByRole('button', { name: 'Accept this key' })).toBeVisible()
  },
})

export const UploadFromChannel = meta.story({
  args: { id: sftpInbox.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Upload a document' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Upload a document' }))
    await waitFor(() =>
      expect(
        sheet.getByRole('combobox', { name: 'Where does the document come from?' }),
      ).toHaveTextContent('Hansemarkt SFTP inbox'),
    )
  },
})

export const OutboundSftp = meta.story({
  args: { id: sftpOutbox.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Upload folder')).toBeVisible()
    await expect(canvas.queryByText('Polling interval')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Upload a document' })).toBeNull()
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
    await userEvent.click(canvas.getByRole('button', { name: 'I have stored the token' }))
    await expect(canvas.getByRole('button', { name: 'Regenerate token' })).toHaveFocus()
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

export const ViewerInboundSftp = meta.story({
  args: { id: sftpInbox.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        await canvas.findByRole('heading', { level: 1, name: 'Hansemarkt SFTP inbox' }),
      ).toBeInTheDocument()
      await expect(canvas.queryByRole('button', { name: 'Upload a document' })).toBeNull()
      await expect(canvas.queryByRole('link', { name: 'Edit' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Test connection/ })).toBeNull()
    },
  }),
})

export const ViewerUncheckedHostKey = meta.story({
  args: { id: uncheckedInbox.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByText("The server's key is not checked yet.")).toBeVisible()
      await expect(canvas.getByText('An Admin can confirm the key.')).toBeVisible()
      await expect(canvas.queryByText(/when you edit the connection/)).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Test connection/ })).toBeNull()
    },
  }),
})

export const ViewerWebhook = meta.story({
  args: { id: webhook.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('heading', { name: 'Webhook' })).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Regenerate token' })).toBeNull()
    },
  }),
})
