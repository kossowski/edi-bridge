import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ManualSubmissionSheet } from '@/components/documents/manual-submission-sheet'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  channelsEndpoint,
  decodeBase64,
  type SubmittedDocument,
  submitDocumentEndpoint,
} from '@edi-bridge/contracts'
import { decodeBytes, decodeInterchange } from '@edi-bridge/edifact'
import dispatchUrl from '@edi-bridge/fixtures/documents/valid/dispatch-nordlicht-markt.csv?url'
import ordersUrl from '@edi-bridge/fixtures/documents/valid/orders-nordlicht-markt.edi?url'
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

// UNOA allows only ASCII, so the ä (E4) makes the Interchange invalid in its character set.
const unoaInterchange = new File(
  [
    "UNB+UNOA:3+4012345000016:14+4098765000013:14+261009:1015+4713'UNH+1+ORDERS:D:96A:UN:EAN008'BGM+220+PO-4+9'NAD+BY+++K",
    new Uint8Array([0xe4]),
    "ufer'UNT+4+1'UNZ+1+4713'",
  ],
  'unoa.edi',
)

async function fixtureFile(url: string, fileName: string) {
  const response = await fetch(url)

  return new File([await response.arrayBuffer()], fileName)
}

// Falls through to the handlers of the mock api, which decode and route what it records.
function recordSubmissions() {
  const received: SubmittedDocument[] = []

  return {
    received,
    handler: http.post(`${apiUrl}${submitDocumentEndpoint.path}`, async ({ request }) => {
      const body = submitDocumentEndpoint.body.safeParse(await request.clone().json())

      if (body.success) {
        received.push(body.data.document)
      }
    }),
  }
}

function receivedText({ content, encoding = 'utf-8' }: SubmittedDocument) {
  const bytes = decodeBase64(content)
  const decoded = decodeInterchange(bytes) ?? decodeBytes(bytes, encoding)

  return 'text' in decoded ? decoded.text : null
}

const channelLabel = 'Where does the document come from?'

const encodingLabel = 'Character encoding'

async function sheet(name = 'Upload a document') {
  const element = await screen.findByRole('dialog', { name })
  await waitFor(() => expect(element).toBeVisible())

  return within(element)
}

async function loaded(content: Awaited<ReturnType<typeof sheet>>, label = channelLabel) {
  const trigger = content.getByRole('combobox', { name: label })
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled'))

  return trigger
}

async function chooseChannel(content: Awaited<ReturnType<typeof sheet>>, channel: string) {
  await userEvent.click(await loaded(content))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(`^${channel}`) }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

async function chooseEncoding(content: Awaited<ReturnType<typeof sheet>>, encoding: string) {
  await userEvent.click(await content.findByRole('combobox', { name: encodingLabel }))
  await userEvent.click(await screen.findByRole('option', { name: encoding }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}

// Upload stays disabled until the Channels load and the chosen file is read.
async function clickUpload(content: Awaited<ReturnType<typeof sheet>>, name = 'Upload') {
  const button = content.getByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

async function submitFile(file: File, channel?: string, encoding?: string) {
  const content = await sheet()

  if (channel) {
    await chooseChannel(content, channel)
  } else {
    // An upload before the channels load finds no default channel.
    await loaded(content)
  }

  await userEvent.upload(content.getByLabelText('File'), file)

  if (encoding) {
    await chooseEncoding(content, encoding)
  }

  await clickUpload(content)

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

    await expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[0-9a-f-]{36}$/),
    )
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

const latinOrders = recordSubmissions()

export const LatinOrders = meta.story({
  beforeEach({ msw }) {
    latinOrders.received.length = 0
    msw.use(latinOrders.handler)
  },
  async play() {
    const file = await fixtureFile(ordersUrl, 'orders-nordlicht-markt.edi')
    const content = await submitFile(file, 'Hansemarkt SFTP inbox')

    await expect(await content.findByRole('heading', { name: '1 document created' })).toBeVisible()
    await expect(content.queryByRole('combobox', { name: encodingLabel })).toBeNull()

    const [received] = latinOrders.received

    await expect(received?.encoding).toBeUndefined()
    await expect(receivedText(received!)).toContain("CTA+OC+:Jana Weiß'")
    await expect(receivedText(received!)).not.toContain('\uFFFD')
  },
})

const windows1252Csv = recordSubmissions()

export const Windows1252Csv = meta.story({
  beforeEach({ msw }) {
    windows1252Csv.received.length = 0
    msw.use(windows1252Csv.handler)
  },
  async play() {
    const file = await fixtureFile(dispatchUrl, 'dispatch-nordlicht-markt.csv')
    const content = await submitFile(file, 'ERP webhook', 'Windows-1252')

    await expect(await content.findByRole('heading', { name: '1 document created' })).toBeVisible()

    const [received] = windows1252Csv.received

    await expect(received?.encoding).toBe('windows-1252')
    await expect(receivedText(received!)).toContain('Grünkohl im Glas 720 ml')
    await expect(receivedText(received!)).not.toContain('\uFFFD')
  },
})

export const WrongEncoding = meta.story({
  async play() {
    const file = await fixtureFile(dispatchUrl, 'dispatch-nordlicht-markt.csv')
    const content = await submitFile(file, 'ERP webhook')
    const alert = await content.findByRole('alert')

    await expect(content.getByRole('combobox', { name: encodingLabel })).toHaveTextContent('UTF-8')
    await expect(alert).toHaveTextContent(
      'The file is not valid UTF-8. Choose another encoding, such as Windows-1252 for a typical German CSV file, and upload it again.',
    )
    await expect(alert).toHaveTextContent(/Details: Byte \d+ \(0xE4\) is not valid UTF-8$/)
    await expect(content.queryByRole('link', { name: 'Set up a document route' })).toBeNull()

    await chooseEncoding(content, 'Windows-1252')
    await expect(content.queryByRole('alert')).toBeNull()
    await clickUpload(content)
    await expect(await content.findByRole('heading', { name: '1 document created' })).toBeVisible()
  },
})

export const UndecodableInterchange = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await submitFile(unoaInterchange)
    const alert = await content.findByRole('alert')

    await expect(alert).toHaveTextContent(
      'The transmission is not valid in the character set its header names. Ask the partner to send it again.',
    )
    await expect(alert).toHaveTextContent(/Details: Byte \d+ \(0xE4\) is not valid in UNOA/)
    await expect(content.queryByRole('combobox', { name: encodingLabel })).toBeNull()
  },
})

export const GermanWrongEncoding = meta.story({
  decorators: [german],
  async play() {
    const file = await fixtureFile(dispatchUrl, 'dispatch-nordlicht-markt.csv')
    const content = await sheet('Beleg hochladen')

    await userEvent.click(await loaded(content, 'Woher kommt der Beleg?'))
    await userEvent.click(await screen.findByRole('option', { name: /^ERP webhook/ }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    await userEvent.upload(content.getByLabelText('Datei'), file)
    await expect(
      await content.findByRole('combobox', { name: 'Zeichenkodierung' }),
    ).toHaveTextContent('UTF-8')
    await clickUpload(content, 'Hochladen')

    const alert = await content.findByRole('alert')

    await expect(alert).toHaveTextContent(
      'Die Datei ist kein gültiges UTF-8. Wählen Sie eine andere Kodierung, etwa Windows-1252 für eine typische deutsche CSV-Datei, und laden Sie sie erneut hoch.',
    )
    await expect(alert).toHaveTextContent(/Details: Byte \d+ \(0xE4\) is not valid UTF-8$/)
    await expect(alert).not.toHaveTextContent('Choose another encoding')
  },
})

export const GermanUndecodableInterchange = meta.story({
  args: { defaultChannelId: inbox.id },
  decorators: [german],
  async play() {
    const content = await sheet('Beleg hochladen')

    await loaded(content, 'Woher kommt der Beleg?')
    await userEvent.upload(content.getByLabelText('Datei'), unoaInterchange)
    await clickUpload(content, 'Hochladen')

    const alert = await content.findByRole('alert')

    await expect(alert).toHaveTextContent(
      'Die Übertragung ist in dem Zeichensatz, den ihr Kopf nennt, nicht gültig. Bitten Sie den Partner, sie erneut zu senden.',
    )
    await expect(alert).toHaveTextContent(/Details: Byte \d+ \(0xE4\) is not valid in UNOA/)
    await expect(content.queryByRole('combobox', { name: 'Zeichenkodierung' })).toBeNull()
  },
})

export const AnotherFileResetsEncoding = meta.story({
  async play() {
    const file = await fixtureFile(dispatchUrl, 'dispatch-nordlicht-markt.csv')
    const content = await sheet()

    await chooseChannel(content, 'ERP webhook')
    await userEvent.upload(content.getByLabelText('File'), file)
    await chooseEncoding(content, 'Windows-1252')
    await userEvent.upload(
      content.getByLabelText('File'),
      new File(['Artikel;Menge\n'], 'another.csv', { type: 'text/csv' }),
    )

    await expect(content.getByText('Chosen: another.csv')).toBeVisible()
    await expect(await content.findByRole('combobox', { name: encodingLabel })).toHaveTextContent(
      'UTF-8',
    )
  },
})

// A file whose bytes never arrive, as a large file still being read.
const unread = Object.assign(new File(['UNB'], 'unread.edi'), {
  arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
})

export const FileBeingRead = meta.story({
  args: { defaultChannelId: inbox.id },
  async play() {
    const content = await sheet()

    await loaded(content)
    await expect(content.getByRole('button', { name: 'Upload' })).toBeEnabled()
    await userEvent.upload(content.getByLabelText('File'), unread)

    await expect(content.getByText('Chosen: unread.edi')).toBeVisible()
    await expect(content.getByRole('button', { name: 'Upload' })).toBeDisabled()
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
    await expect((await sheet()).getByRole('button', { name: 'Upload' })).toBeDisabled()
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
    await clickUpload(content, 'Hochladen')
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
