import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { channelsEndpoint, submitDocumentEndpoint } from '@edi-bridge/contracts'
import { createChannels, createHandlers, seedChannels } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const inbox = seedChannels.find(({ name }) => name === 'Hansemarkt SFTP inbox')!

const twoOrders = [
  "UNA:+.? 'UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+4711'",
  "UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-1+9'UNT+3+1'",
  "UNH+2+ORDERS:D:96A:UN:EAN008'BGM+220+PO-2+9'UNT+3+2'",
  "UNZ+2+4711'",
].join('\n')

const mixedInterchange = [
  "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+4712'",
  "UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-3+9'UNT+3+1'",
  "UNH+2+DESADV:D:96A:UN:EAN007'BGM+351+DN-1+9'UNT+3+2'",
  "UNH+3+PRICAT:D:96A:UN:EAN008'BGM+9+PL-1+9'UNT+3+3'",
  "UNZ+3+4712'",
].join('\n')

const mixed = new File([mixedInterchange], 'mixed.edi', { type: 'text/plain' })

const orders = new File([twoOrders], 'orders.edi', { type: 'text/plain' })

const notes = new File(['Please ship by Friday.'], 'notes.txt', { type: 'text/plain' })

// Waits out the opening fade, so visibility checks see the settled dialog.
async function dialog() {
  const element = await screen.findByRole('dialog')
  await waitFor(() => expect(element).toBeVisible())

  return element
}

async function choose(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

async function loaded(trigger: HTMLElement) {
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled'))
}

async function submit(file: File, channel?: string) {
  const content = within(await dialog())

  if (channel) {
    const trigger = content.getByRole('combobox', { name: 'Inbound Channel' })
    await loaded(trigger)
    await choose(trigger, channel)
  }

  await userEvent.upload(content.getByLabelText('Document'), file)
  await userEvent.click(content.getByRole('button', { name: 'Submit Document' }))
}

const meta = preview.meta({
  title: 'Runs/ManualSubmissionDialog',
  component: ManualSubmissionDialog,
  args: { defaultOpen: true },
  // The dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Closed = meta.story({
  args: { defaultOpen: false },
  async play({ canvas }) {
    const trigger = canvas.getByRole('button', { name: 'Submit a Document' })
    await userEvent.click(trigger)
    await expect(await dialog()).toHaveAccessibleName('Manual Submission')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(trigger).toHaveFocus()
  },
})

export const SubmitInterchange = meta.story({
  async play() {
    await submit(orders, 'Hansemarkt SFTP inbox')
    const content = within(await dialog())

    await waitFor(() =>
      expect(content.getByRole('heading', { name: '2 Runs created' })).toHaveFocus(),
    )
    await expect(
      content.getByText('orders.edi was submitted on Hansemarkt SFTP inbox.'),
    ).toBeVisible()

    const links = content.getAllByRole('link', { name: /^Open Run ORDERS from Hansemarkt GmbH/ })
    await expect(links).toHaveLength(2)
    await expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/runs\/[0-9a-f-]{36}$/))
    await expect(content.getAllByText('Delivered')).toHaveLength(2)
    await expect(content.queryByText(/not routed/)).toBeNull()
  },
})

export const MixedInterchange = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    await submit(mixed)
    const content = within(await dialog())

    await expect(await content.findByRole('heading', { name: '1 Run created' })).toBeVisible()
    await expect(
      content.getByRole('link', { name: /^Open Run ORDERS from Hansemarkt GmbH/ }),
    ).toBeVisible()
    await expect(content.getByText('2 Messages not routed')).toBeVisible()
    await expect(
      content.getByText(/^No Flow on Hansemarkt SFTP inbox routes these Message Types/),
    ).toBeVisible()
    await expect(content.getByText('DESADV')).toBeVisible()
    await expect(content.getByText('PRICAT')).toBeVisible()
  },
})

export const ParseFailure = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    await submit(notes)
    const content = within(await dialog())

    await expect(await content.findByRole('heading', { name: '1 Run created' })).toBeVisible()
    await expect(content.getByText('Failed')).toBeVisible()
    await expect(content.getByText('Parse')).toBeVisible()
  },
})

export const SubmitAnother = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    await submit(orders)
    const content = within(await dialog())

    await userEvent.click(await content.findByRole('button', { name: 'Submit another Document' }))
    await expect(content.getByRole('combobox', { name: 'Inbound Channel' })).toHaveFocus()
    await expect(content.getByRole('combobox', { name: 'Inbound Channel' })).toHaveTextContent(
      'Hansemarkt SFTP inbox',
    )
  },
})

export const PreselectedChannel = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = within(await dialog())

    await waitFor(() =>
      expect(content.getByRole('combobox', { name: 'Inbound Channel' })).toHaveTextContent(
        'Hansemarkt SFTP inbox',
      ),
    )
  },
})

export const MissingInput = meta.story({
  async play() {
    const content = within(await dialog())

    await userEvent.click(content.getByRole('button', { name: 'Submit Document' }))
    await expect(await content.findByText('Choose an inbound Channel.')).toBeVisible()
    await expect(content.getByText('Choose a file.')).toBeVisible()
    await expect(content.getByRole('combobox', { name: 'Inbound Channel' })).toHaveFocus()
    await expect(content.getByLabelText('Document')).toHaveAttribute('aria-invalid', 'true')
  },
})

export const EmptyDocument = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    await submit(new File([], 'empty.edi'))

    const content = within(await dialog())

    await expect(await content.findByText('The Document is empty.')).toBeVisible()
    await expect(content.getByLabelText('Document')).toHaveFocus()
  },
})

export const Submitting = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${submitDocumentEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play() {
    await submit(orders)

    await expect(
      await within(await dialog()).findByRole('button', { name: 'Submitting Document…' }),
    ).toBeDisabled()
  },
})

export const SubmitFails = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${submitDocumentEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    await submit(orders)

    await expect(await within(await dialog()).findByRole('alert')).toHaveTextContent(
      'The Document could not be submitted. Try again.',
    )
  },
})

export const NoFlowForChannel = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${submitDocumentEndpoint.path}`, () =>
        HttpResponse.json(
          { message: 'No Flow on this Channel routes a Message of this Document' },
          { status: 422 },
        ),
      ),
    )
  },
  async play() {
    await submit(orders)

    await expect(await within(await dialog()).findByRole('alert')).toHaveTextContent(
      'No Flow on this Channel routes the Messages of this Document.',
    )
  },
})

export const ChannelsLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play() {
    const trigger = within(await dialog()).getByRole('combobox', { name: 'Inbound Channel' })

    await expect(trigger).toHaveAttribute('aria-disabled', 'true')
    await expect(trigger).toHaveTextContent('Loading Channels…')
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expect(screen.queryByRole('listbox')).toBeNull()
  },
})

export const FocusOnOpen = meta.story({
  async play() {
    const trigger = within(await dialog()).getByRole('combobox', { name: 'Inbound Channel' })

    await waitFor(() => expect(trigger).toHaveFocus())
    await loaded(trigger)
    await expect(trigger).toHaveFocus()
  },
})

export const ChannelsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    const content = within(await dialog())

    await expect(await content.findByRole('alert')).toHaveTextContent(
      'The Channels could not be loaded.',
    )
    await expect(content.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NoInboundChannels = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        channels: seedChannels.filter(({ direction }) => direction === 'outbound'),
      }),
    )
  },
  async play() {
    const content = within(await dialog())

    await expect(await content.findByText('No inbound Channel yet')).toBeVisible()
    await expect(content.getByRole('link', { name: 'New Channel' })).toHaveAttribute(
      'href',
      '/channels/new',
    )
  },
})

export const LargeChannelList = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { channels: createChannels({ count: 400 }) }))
  },
  async play() {
    const trigger = within(await dialog()).getByRole('combobox', { name: 'Inbound Channel' })

    await loaded(trigger)
    await userEvent.click(trigger)
    await expect((await screen.findAllByRole('option')).length).toBeGreaterThan(100)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  },
})

export const German = meta.story({
  args: { defaultChannelId: inbox.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    const content = within(await dialog())

    await userEvent.upload(content.getByLabelText('Document'), mixed)
    await userEvent.click(content.getByRole('button', { name: 'Document einreichen' }))
    await expect(await content.findByRole('heading', { name: '1 Run angelegt' })).toBeVisible()
    await expect(content.getByText('2 Messages nicht weitergeleitet')).toBeVisible()
    await userEvent.click(content.getByRole('button', { name: 'Fertig' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Ein Document einreichen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play() {
    await submit(notes)

    await expect(await within(await dialog()).findByText('Failed')).toBeVisible()
  },
})
