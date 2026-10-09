import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { EditChannelScreen, NewChannelScreen } from '@/components/channels/channel-form-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { updateChannelEndpoint } from '@edi-bridge/contracts'
import { createHandlers, seedChannels } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const sftpInbox = seeded('Hansemarkt SFTP inbox')

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
    await expect(canvas.getByRole('heading', { name: 'New Channel' })).toBeVisible()
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
    await userEvent.click(canvas.getByRole('button', { name: 'Create Channel' }))
    await expect(canvas.getByLabelText('Name')).toHaveFocus()
    await expect(canvas.getByText('Enter a host.')).toBeVisible()
    await expect(canvas.getByText('Enter the password or private key.')).toBeVisible()
  },
})

export const CreatedWebhook = meta.story({
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('radio', { name: /^Inbound webhook/ }))
    await userEvent.type(canvas.getByLabelText('Name'), 'Shop webhook')
    await userEvent.click(canvas.getByRole('button', { name: 'Create Channel' }))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Copy the webhook token now' })).toHaveFocus(),
    )
    await expect(canvas.getByText(/^whk_[A-Za-z0-9]{32}$/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Go to the Channel' })).toBeVisible()
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
      'The Channel could not be saved.',
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
      'The kind of a Channel cannot change.',
    )
  },
})

export const EditNotFound = meta.story({
  render: () => <EditChannelScreen id="10000000-0000-4000-8000-0000000000ff" />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Channel not found')).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: 'Channel anlegen' })).toBeVisible()
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
