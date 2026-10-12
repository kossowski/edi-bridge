import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ManualSubmissionSheet } from '@/components/documents/manual-submission-sheet'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { channelsEndpoint, submitDocumentEndpoint } from '@edi-bridge/contracts'
import { createHandlers, seedChannels } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const inbox = seedChannels.find(({ name }) => name === 'Hansemarkt SFTP inbox')!

const oneOrder = [
  "UNB+UNOC:3+4012345000016:14+4098765000013:14+261009:1015+4710'",
  "UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-1+9'UNT+3+1'",
  "UNZ+1+4710'",
].join('\n')

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

const order = new File([oneOrder], 'order.edi', { type: 'text/plain' })

const orders = new File([twoOrders], 'orders.edi', { type: 'text/plain' })

const mixed = new File([mixedInterchange], 'mixed.edi', { type: 'text/plain' })

const channelLabel = 'Where does the document come from?'

async function sheet(name = 'Upload a document') {
  const element = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(element).toBeVisible())

  return within(element)
}

async function loaded(content: Awaited<ReturnType<typeof sheet>>) {
  const trigger = content.getByRole('combobox', { name: channelLabel })
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled'))

  return trigger
}

async function chooseChannel(content: Awaited<ReturnType<typeof sheet>>, channel: string) {
  await userEvent.click(await loaded(content))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${channel}`) }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

async function submitFile(file: File, channel?: string) {
  const content = await sheet()

  if (channel) {
    await chooseChannel(content, channel)
  }

  await userEvent.upload(content.getByLabelText('File'), file)
  await userEvent.click(content.getByRole('button', { name: 'Upload' }))

  return content
}

const meta = preview.meta({
  title: 'Documents/ManualSubmissionSheet',
  component: ManualSubmissionSheet,
  args: { defaultOpen: true },
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Closed = meta.story({
  args: { defaultOpen: false },
  async play({ canvas }) {
    const trigger = canvas.getByRole('button', { name: 'Upload a document' })
    await userEvent.click(trigger)
    await sheet()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(trigger).toHaveFocus()
  },
})

export const Default = meta.story({
  async play() {
    const content = await sheet()
    const trigger = await loaded(content)

    await expect(trigger).toHaveTextContent('Choose a connection')
    await userEvent.click(trigger)
    await expect(
      await screen.findByRole('option', { name: /^Hansemarkt SFTP inbox/ }),
    ).toHaveTextContent('Inbound SFTP · Hansemarkt GmbH')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  },
})

export const PreselectedChannel = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await sheet()

    await waitFor(() =>
      expect(content.getByRole('combobox', { name: channelLabel })).toHaveTextContent(
        'Hansemarkt SFTP inbox',
      ),
    )
  },
})

export const FileChosen = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await sheet()

    await userEvent.upload(content.getByLabelText('File'), orders)
    await expect(content.getByText('Chosen: orders.edi')).toBeVisible()
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
    const content = await submitFile(orders)

    await expect(await content.findByRole('button', { name: 'Uploading…' })).toBeDisabled()
  },
})

export const OneDocument = meta.story({
  async play() {
    const content = await submitFile(order, 'Hansemarkt SFTP inbox')

    await waitFor(() =>
      expect(content.getByRole('heading', { name: '1 document created' })).toHaveFocus(),
    )
    await expect(
      content.getByText('order.edi was processed as if it had arrived on Hansemarkt SFTP inbox.'),
    ).toBeVisible()

    const link = content.getByRole('link', {
      name: /^Open it\W+Purchase order \w+ from Hansemarkt GmbH$/,
    })

    await expect(link).toHaveAttribute('href', expect.stringMatching(/^\/runs\/[0-9a-f-]{36}$/))
    await expect(content.getByText('Delivered')).toBeVisible()
  },
})

export const SeveralDocuments = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(orders)

    await expect(await content.findByRole('heading', { name: '2 documents created' })).toBeVisible()
    await expect(
      within(content.getByRole('list', { name: 'Created documents' })).getAllByRole('link', {
        name: /^Open it/,
      }),
    ).toHaveLength(2)
    await expect(content.queryByText(/not processed/)).toBeNull()
  },
})

export const PartlyNotRouted = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(mixed)

    await expect(await content.findByRole('heading', { name: '1 document created' })).toBeVisible()
    await expect(content.getByText('2 parts of the file were not processed')).toBeVisible()
    await expect(content.getByText('Dispatch advice')).toBeVisible()
    await expect(content.getByText('PRICAT')).toBeVisible()
    await expect(content.getByRole('link', { name: 'Set up a document route' })).toHaveAttribute(
      'href',
      '/flows/new',
    )
  },
})

export const AnotherFile = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(orders)

    await userEvent.click(await content.findByRole('button', { name: 'Upload another file' }))
    await expect(content.getByLabelText('File')).toHaveFocus()
    await expect(content.getByRole('combobox', { name: channelLabel })).toHaveTextContent(
      'Hansemarkt SFTP inbox',
    )
  },
})

export const ValidationError = meta.story({
  async play() {
    const content = await sheet()
    await loaded(content)

    await userEvent.click(content.getByRole('button', { name: 'Upload' }))
    await expect(await content.findByText('Choose where the document comes from.')).toBeVisible()
    await expect(content.getByText('Choose a file.')).toBeVisible()
    await expect(content.getByRole('combobox', { name: channelLabel })).toHaveFocus()
    await expect(content.getByLabelText('File')).toHaveAttribute('aria-invalid', 'true')
  },
})

export const EmptyFile = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(new File([], 'empty.edi'))

    await expect(await content.findByText('The file is empty.')).toBeVisible()
    await expect(content.getByLabelText('File')).toHaveFocus()
  },
})

export const ServerError = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${submitDocumentEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    const content = await submitFile(orders)

    await expect(await content.findByRole('alert')).toHaveTextContent(
      'The file could not be uploaded. Try again.',
    )
    await expect(content.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

const unroutable = http.post(`${apiUrl}${submitDocumentEndpoint.path}`, () =>
  HttpResponse.json(
    { message: 'No Flow on this Channel routes a Message of this Document' },
    { status: 422 },
  ),
)

export const NothingRoutable = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(unroutable)
  },
  async play() {
    const content = await submitFile(orders)

    await expect(await content.findByRole('alert')).toHaveTextContent(
      'No document route on this connection handles the documents in this file.',
    )
    await expect(content.getByRole('link', { name: 'Set up a document route' })).toBeVisible()
  },
})

export const ChannelChangeClearsFailure = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach({ msw }) {
    msw.use(unroutable)
  },
  async play() {
    const content = await submitFile(orders)

    await content.findByRole('alert')
    await chooseChannel(content, 'ERP webhook')
    await expect(content.queryByRole('alert')).toBeNull()
  },
})

export const ConnectionsLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play() {
    const trigger = (await sheet()).getByRole('combobox', { name: channelLabel })

    await expect(trigger).toHaveAttribute('aria-disabled', 'true')
    await expect(trigger).toHaveTextContent('Loading connections…')
  },
})

export const ConnectionsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    const content = await sheet()

    await expect(await content.findByRole('alert')).toHaveTextContent(
      'The connections could not be loaded.',
    )
    await expect(content.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(content.getByRole('button', { name: 'Upload' })).toBeDisabled()
  },
})

export const NoInboundConnections = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        channels: seedChannels.filter(({ direction }) => direction === 'outbound'),
      }),
    )
  },
  async play() {
    const content = await sheet()

    await expect(await content.findByText('No incoming connection yet')).toBeVisible()
    await expect(content.getByRole('link', { name: 'Set up a connection' })).toHaveAttribute(
      'href',
      '/channels/new',
    )
    await expect(content.queryByRole('button', { name: 'Upload' })).toBeNull()
  },
})

export const German = meta.story({
  args: { defaultChannelId: inbox.id },
  decorators: [german],
  async play({ canvas }) {
    const content = await sheet('Beleg hochladen')

    await userEvent.upload(content.getByLabelText('Datei'), mixed)
    await userEvent.click(content.getByRole('button', { name: 'Hochladen' }))
    await expect(await content.findByRole('heading', { name: '1 Beleg angelegt' })).toBeVisible()
    await expect(content.getByText('2 Teile der Datei wurden nicht verarbeitet')).toBeVisible()
    await userEvent.click(content.getByRole('button', { name: 'Fertig' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Beleg hochladen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { defaultChannelId: inbox.id },
  beforeEach: darkMode,
  async play() {
    const content = await submitFile(mixed)

    await expect(await content.findByText('2 parts of the file were not processed')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(orders)

    await expect(await content.findByRole('heading', { name: '2 documents created' })).toBeVisible()
    const popup = await screen.findByRole('dialog', { name: 'Upload a document' })
    await expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
})
