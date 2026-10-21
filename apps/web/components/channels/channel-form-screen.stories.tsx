import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EditChannelScreen, NewChannelScreen } from '@/components/channels/channel-form-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { channelEndpoint, updateChannelEndpoint } from '@edi-bridge/contracts'
import {
  channelHandlers,
  createChannelStore,
  createHandlers,
  passphraseProtectedChannel,
  seedChannels,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const sftpInbox = seeded('Hansemarkt SFTP inbox')

const uncheckedInbox = seeded('Alpenfrisch SFTP inbox')

const webhook = seeded('ERP webhook')

const httpDelivery = seeded('ERP HTTP delivery')

function failingUpdate(status: number) {
  return http.put(`${apiUrl}${updateChannelEndpoint.path}`, () =>
    HttpResponse.json({ message: 'Rejected' }, { status }),
  )
}

const meta = preview.meta({
  title: 'Channels/ChannelFormScreen',
  component: NewChannelScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const NewInboundSftp = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'New connection' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('radio', { name: /^Inbound SFTP/ })).toBeChecked()
    await expect(canvas.getByLabelText('Polling interval (minutes)')).toHaveValue(1)
    await expect(canvas.getByLabelText('Port')).toHaveValue(22)
  },
})

export const NewOutboundSftp = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('radio', { name: /^Outbound SFTP/ }))
    await expect(canvas.queryByLabelText('Polling interval (minutes)')).toBeNull()
  },
})

export const NewOutboundHttp = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('radio', { name: /^Outbound HTTP/ }))
    await expect(canvas.getByLabelText('URL')).toHaveValue('')
    await expect(
      canvas.getByRole('checkbox', { name: 'Send an Authorization header' }),
    ).toBeChecked()
  },
})

export const ValidationErrors = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Create connection' }))
    await expect(canvas.getByLabelText('Name')).toHaveFocus()
    await expect(canvas.getByText('Enter a host.')).toBeVisible()
    await expect(canvas.getByText('Enter the password or private key.')).toBeVisible()
  },
})

export const CreatedWebhook = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('radio', { name: /^Inbound webhook/ }))
    await userEvent.type(canvas.getByLabelText('Name'), 'Shop webhook')
    await userEvent.click(canvas.getByRole('button', { name: 'Create connection' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Copy the webhook token now' })).toHaveFocus(),
    )
    await expect(canvas.getByText(/^whk_[A-Za-z0-9]{32}$/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to the connection' })).toBeVisible()
  },
})

export const EditInboundSftp = meta.story({
  render: () => <EditChannelScreen id={sftpInbox.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Host')).toHaveValue(
      sftpInbox.type === 'sftp' ? sftpInbox.host : '',
    )
    await expect(canvas.getByText('Inbound SFTP')).toBeVisible()
    await expect(canvas.queryByRole('radio')).toBeNull()
    await expect(canvas.getByText(/Leave blank to keep the current one/)).toBeVisible()
  },
})

export const PasteHostKey = meta.story({
  async play({ canvas }) {
    const field = canvas.getByLabelText('Host key fingerprint (optional)')
    await expect(field).toHaveValue('')
    await expect(
      canvas.getByText(/host key \(usually Ed25519\), as ssh-keygen -lf prints it/),
    ).toBeVisible()
    await userEvent.type(field, '16:27:ac:a5')
    await userEvent.click(canvas.getByRole('button', { name: 'Create connection' }))
    await expect(
      canvas.getByText('Enter the fingerprint as SHA256: followed by 43 characters.'),
    ).toBeVisible()
  },
})

export const InvalidHostKey = meta.story({
  async play({ canvas }) {
    const field = canvas.getByLabelText('Host key fingerprint (optional)')
    await expect(field).toHaveAttribute('aria-invalid', 'false')
    await userEvent.type(field, 'SHA256:abc')
    await userEvent.click(canvas.getByRole('button', { name: 'Create connection' }))
    await expect(
      canvas.getByText('Enter the fingerprint as SHA256: followed by 43 characters.'),
    ).toBeVisible()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
  },
})

export const EditConfirmedHostKey = meta.story({
  render: () => <EditChannelScreen id={sftpInbox.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Host key fingerprint (optional)')).toHaveValue(
      sftpInbox.type === 'sftp' ? sftpInbox.hostKeyFingerprint : '',
    )
    await expect(canvas.getByText(/Clear it to stop checking the key/)).toBeVisible()
  },
})

export const EditUncheckedHostKey = meta.story({
  render: () => <EditChannelScreen id={uncheckedInbox.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Host key fingerprint (optional)')).toHaveValue('')
  },
})

async function choosePrivateKey(canvas: { getByRole: typeof screen.getByRole }) {
  await userEvent.click(canvas.getByRole('combobox', { name: 'Authentication' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Private key' }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

export const NewPrivateKeyPassphrase = meta.story({
  async play({ canvas }) {
    await expect(canvas.queryByLabelText('Passphrase (optional)')).toBeNull()
    await choosePrivateKey(canvas)

    const passphrase = canvas.getByLabelText('Passphrase (optional)')
    await expect(passphrase).toHaveAttribute('type', 'password')
    await expect(passphrase).toHaveValue('')
    await expect(passphrase).toHaveAccessibleDescription(
      /^Only for a private key protected by a passphrase/,
    )
    await expect(
      canvas.queryByRole('checkbox', { name: 'Remove the stored passphrase' }),
    ).toBeNull()
  },
})

let protectedStore = createChannelStore([passphraseProtectedChannel])

export const EditStoredPassphrase = meta.story({
  render: () => <EditChannelScreen id={passphraseProtectedChannel.id} />,
  beforeEach({ msw }) {
    protectedStore = createChannelStore([passphraseProtectedChannel])
    msw.use(...channelHandlers(apiUrl, { channels: protectedStore }))
  },
  async play({ canvas }) {
    const passphrase = await canvas.findByLabelText('Passphrase (optional)')
    await expect(passphrase).toHaveValue('')
    await expect(passphrase).toHaveAccessibleDescription(
      'Stored encrypted and never shown again. Leave blank to keep the current one; it stays with a new private key until you remove it.',
    )

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Remove the stored passphrase' }))
    await expect(canvas.queryByLabelText('Passphrase (optional)')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(`/channels/${passphraseProtectedChannel.id}`),
    )
    await expect(protectedStore.get(passphraseProtectedChannel.id)).not.toHaveProperty('passphrase')
  },
})

export const GermanPassphrase = meta.story({
  render: () => <EditChannelScreen id={passphraseProtectedChannel.id} />,
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: [passphraseProtectedChannel] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Passphrase (optional)')).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'Gespeicherte Passphrase entfernen' }),
    ).not.toBeChecked()
  },
})

export const EditWebhook = meta.story({
  render: () => <EditChannelScreen id={webhook.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Rate limit (requests per minute)')).toHaveValue(60)
  },
})

export const EditOutboundHttp = meta.story({
  render: () => <EditChannelScreen id={httpDelivery.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Authorization header value')).toHaveValue('')
    await expect(canvas.getByText(/Leave blank to keep the current value/)).toBeVisible()
  },
})

export const SaveFails = meta.story({
  render: () => <EditChannelScreen id={webhook.id} />,
  beforeEach({ msw }) {
    msw.use(failingUpdate(500))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The connection could not be saved.',
    )
  },
})

export const KindConflict = meta.story({
  render: () => <EditChannelScreen id={webhook.id} />,
  beforeEach({ msw }) {
    msw.use(failingUpdate(409))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The kind of a connection cannot change.',
    )
  },
})

export const EditNotFound = meta.story({
  render: () => <EditChannelScreen id="10000000-0000-4000-8000-0000000000ff" />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Connection not found')).toBeVisible()
  },
})

export const EditLoading = meta.story({
  render: () => <EditChannelScreen id={sftpInbox.id} />,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading connection')).toBeInTheDocument()
  },
})

export const EditUnavailable = meta.story({
  render: () => <EditChannelScreen id={sftpInbox.id} />,
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Connection unavailable')).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: 'Verbindung anlegen' })).toBeVisible()
    await expect(
      canvas.getByLabelText('Fingerabdruck des Serverschlüssels (optional)'),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  render: () => <EditChannelScreen id={sftpInbox.id} />,
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Save changes' })).toBeVisible()
  },
})
