import { delay, http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'

import { DocumentScreen } from '@/components/documents/document-screen'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  type FailureStage,
  type MessageType,
  runEndpoint,
  type RunStatus,
  toPath,
  waitForTradingPartnerRunEndpoint,
} from '@edi-bridge/contracts'
import {
  controlReferenceOf,
  createLookupTableStore,
  createRun,
  interchangeIdOf,
  runDetailHandlers,
  seedChannels,
  seedFlows,
  seedTradingPartners,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const partner = seedTradingPartners[0]!

function flowFor(messageType: MessageType) {
  return seedFlows.find(
    (candidate) =>
      candidate.tradingPartnerId === partner.id && candidate.messageType === messageType,
  )!
}

function storyRun(
  index: number,
  messageType: MessageType,
  outcome: FailureStage | Exclude<RunStatus, 'failed'>,
  changes: { receivedAt?: string; manualSubmission?: boolean } = {},
) {
  const flow = flowFor(messageType)

  const run = {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    receivedAt: `2026-10-08T07:${String(index).padStart(2, '0')}:13.000Z`,
    tradingPartner: partner,
    messageType,
    flow: { id: flow.id, name: flow.name },
    manualSubmission: false,
    ...changes,
  }

  return outcome === 'parse' ||
    outcome === 'validation' ||
    outcome === 'mapping' ||
    outcome === 'delivery'
    ? createRun({ ...run, status: 'failed', failureStage: outcome })
    : createRun({ ...run, status: outcome, failureStage: null })
}

const missingField = storyRun(1, 'INVOIC', 'mapping')

const unreadable = storyRun(2, 'ORDERS', 'parse')

const invalidContentInbound = storyRun(3, 'ORDERS', 'validation')

const invalidContentOutbound = storyRun(4, 'DESADV', 'validation')

const missingCode = storyRun(5, 'ORDERS', 'mapping')

const unreachableOutbound = storyRun(6, 'INVOIC', 'delivery')

const unreachableInbound = storyRun(7, 'ORDERS', 'delivery')

const delivered = storyRun(8, 'ORDERS', 'delivered')

const uploaded = storyRun(9, 'ORDERS', 'delivered', { manualSubmission: true })

const processing = storyRun(10, 'ORDERS', 'processing')

const received = storyRun(11, 'ORDERS', 'received')

const original = storyRun(12, 'ORDERS', 'delivered', { receivedAt: '2026-10-07T07:00:00.000Z' })

const duplicateRun = storyRun(13, 'ORDERS', 'duplicate')

const duplicate = {
  ...duplicateRun,
  interchange: {
    id: interchangeIdOf(duplicateRun),
    controlReference: controlReferenceOf(interchangeIdOf(original)),
  },
}

const runs = [
  missingField,
  unreadable,
  invalidContentInbound,
  invalidContentOutbound,
  missingCode,
  unreachableOutbound,
  unreachableInbound,
  delivered,
  uploaded,
  processing,
  received,
  original,
  duplicate,
]

const channel = seedChannels.find(({ id }) => id === flowFor('INVOIC').destinationChannelId)!

const meta = preview.meta({
  title: 'Documents/DocumentScreen',
  component: DocumentScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...runDetailHandlers(apiUrl, { runs }))
  },
})

async function expectFixLink(link: HTMLElement, href: string) {
  await expect(link).toBeVisible()
  await expect(link.getAttribute('href')).toBe(href)
}

export const UnreadableFile = meta.story({
  args: { id: unreadable.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: `${partner.name} sent a damaged file` }),
    ).toBeVisible()
    await expect(canvas.getByText('Your partner fixes this')).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Open ${partner.name}` }),
      `/trading-partners/${partner.id}`,
    )
  },
})

export const InvalidContentFromPartner = meta.story({
  args: { id: invalidContentInbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The content breaks the EDI rules' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        `Nothing to fix on your side. ${partner.name} has to send a corrected file.`,
      ),
    ).toBeVisible()
  },
})

export const WaitingForPartner = meta.story({
  args: { id: unreadable.id },
  async beforeEach() {
    await fetch(
      `${apiUrl}${toPath(waitForTradingPartnerRunEndpoint.path, { id: unreadable.id })}`,
      {
        method: 'POST',
      },
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(`Marked as waiting for ${partner.name} since`, { exact: false }),
    ).toBeVisible()
  },
})

export const InvalidContentFromYou = meta.story({
  args: { id: invalidContentOutbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required value is empty' }),
    ).toBeVisible()
    await expect(canvas.getByText('You fix this')).toBeVisible()
    const link = canvas.getByRole('link', { name: /at this field$/ })
    await expect(link.getAttribute('href')).toMatch(
      /^\/mappings\/[\w-]+\?field=(buyer|supplier)\.gln$/,
    )
  },
})

export const MissingCode = meta.story({
  args: { id: missingCode.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The code “KRT” has no translation' }),
    ).toBeVisible()
    const link = canvas.getByRole('link', { name: 'Add KRT to “Units of measure”' })
    await expect(link.getAttribute('href')).toMatch(/^\/lookup-tables\/[\w-]+\?code=KRT$/)
  },
})

export const MissingField = meta.story({
  args: { id: missingField.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required field is empty' }),
    ).toBeVisible()
    await expect(canvas.getByText(/reads the field “lines\[\]\.gtin”/)).toBeVisible()
    const link = canvas.getByRole('link', { name: /at this field$/ })
    await expect(link.getAttribute('href')).toMatch(/\?field=lines%5B%5D\.gtin$/)
  },
})

export const WithoutFixTarget = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...runDetailHandlers(apiUrl, { runs, lookupTables: createLookupTableStore([]) }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A code has no translation' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'What to do' })).toBeNull()
  },
})

export const DeliveryFailure = meta.story({
  args: { id: unreachableOutbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: `The server of ${partner.name} did not answer` }),
    ).toBeVisible()
    await expect(canvas.getByText('Just try again')).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Check the connection “${channel.name}”` }),
      `/channels/${channel.id}`,
    )
  },
})

export const DeliveryFailureToErp = meta.story({
  args: { id: unreachableInbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Your ERP did not answer' }),
    ).toBeVisible()
  },
})

export const Delivered = meta.story({
  args: { id: delivered.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'All good, nothing to do' }),
    ).toBeVisible()
    await expect(canvas.getByText(/^Received/)).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `View the whole order ${delivered.businessReference}` }),
      `/order-lifecycle?businessReference=${delivered.businessReference}`,
    )
    await expect(canvas.queryByText('Uploaded by hand', { exact: false })).toBeNull()
  },
})

export const UploadedByHand = meta.story({
  args: { id: uploaded.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Uploaded by hand', { exact: false })).toBeVisible()
  },
})

export const InProgress = meta.story({
  args: { id: processing.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Still being processed' }),
    ).toBeVisible()
  },
})

export const Received = meta.story({
  args: { id: received.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Still being processed' }),
    ).toBeVisible()
  },
})

export const Duplicate = meta.story({
  args: { id: duplicate.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Received twice, ignored' }),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: 'Open the original document' }),
      `/documents/${original.id}`,
    )
  },
})

export const Loading = meta.story({
  args: { id: delivered.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading document')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: delivered.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '40000000-0000-4000-8000-999999999999' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document not found')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: missingCode.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Für den Code „KRT“ fehlt eine Übersetzung' }),
    ).toBeVisible()
    await expect(canvas.getByText('Sie beheben das')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: missingCode.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The code “KRT” has no translation' }),
    ).toBeVisible()
  },
})

export const DarkDelivered = meta.story({
  args: { id: delivered.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'All good, nothing to do' }),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  args: { id: missingField.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required field is empty' }),
    ).toBeVisible()
    await expectNoPageScroll(canvasElement)
    const link = canvas.getByRole('link', { name: /at this field$/ })
    const card = link.closest('[data-slot="card"]')!
    await expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
      card.getBoundingClientRect().right,
    )
  },
})
