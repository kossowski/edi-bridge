import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { RunDetailScreen } from '@/components/runs/run-detail-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { type FailureStage, type MessageType, runEndpoint } from '@edi-bridge/contracts'
import { createRun, runDetailHandlers, seedFlows, seedTradingPartners } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const partner = seedTradingPartners[0]!

function flowFor(messageType: MessageType) {
  const flow = seedFlows.find(
    (candidate) =>
      candidate.tradingPartnerId === partner.id && candidate.messageType === messageType,
  )!

  return { id: flow.id, name: flow.name }
}

function storyRun(
  index: number,
  messageType: MessageType,
  failureStage?: FailureStage,
  receivedAt = '2026-10-08T07:42:13.000Z',
) {
  const run = {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    receivedAt,
    tradingPartner: partner,
    messageType,
    flow: flowFor(messageType),
    manualSubmission: false,
  }

  return failureStage === undefined
    ? createRun({ ...run, status: 'delivered', failureStage: null })
    : createRun({ ...run, status: 'failed', failureStage })
}

const delivered = storyRun(1, 'ORDERS')

const deliveryFailure = storyRun(2, 'INVOIC', 'delivery')

const mappingFailure = storyRun(3, 'ORDERS', 'mapping', '2026-10-08T07:50:00.000Z')

const parseFailure = storyRun(4, 'ORDERS', 'parse', '2026-10-08T08:00:00.000Z')

const validationFailure = storyRun(5, 'ORDERS', 'validation', '2026-10-08T08:10:00.000Z')

const outboundValidationFailure = storyRun(6, 'DESADV', 'validation')

const outboundMappingFailure = storyRun(7, 'INVOIC', 'mapping')

const replaced = storyRun(8, 'ORDERS', 'mapping', '2026-10-08T08:20:00.000Z')

const replacing = storyRun(9, 'ORDERS', undefined, '2026-10-08T09:05:00.000Z')

const processing = createRun({
  ...storyRun(10, 'ORDERS', undefined, '2026-10-08T08:30:00.000Z'),
  status: 'processing',
  failureStage: null,
})

const bundled = Array.from({ length: 120 }, (_, index) =>
  storyRun(
    100 + index,
    'ORDERS',
    index === 97 ? 'validation' : undefined,
    '2026-10-08T06:00:00.000Z',
  ),
)

const runs = [
  delivered,
  deliveryFailure,
  mappingFailure,
  parseFailure,
  validationFailure,
  outboundValidationFailure,
  outboundMappingFailure,
  replaced,
  replacing,
  processing,
  ...bundled,
]

const meta = preview.meta({
  title: 'Runs/RunDetailScreen',
  component: RunDetailScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(
      ...runDetailHandlers(apiUrl, {
        runs,
        reprocessed: [{ replaced: replaced.id, replacing: replacing.id }],
      }),
    )
  },
})

export const Delivered = meta.story({
  args: { id: delivered.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Delivered')).toBeVisible()
    await expect(
      canvas.getByRole('region', { name: 'Raw Interchange, one segment per line' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Remedy' })).toBeNull()
  },
})

export const DeliveryFailure = meta.story({
  args: { id: deliveryFailure.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Retry' })).toBeEnabled()
    await expect(canvas.queryByRole('button', { name: 'Reprocess' })).toBeNull()
  },
})

export const MappingFailure = meta.story({
  args: { id: mappingFailure.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Reprocess' })).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Mapping Version' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Retry' })).toBeNull()
  },
})

export const ParseFailure = meta.story({
  args: { id: parseFailure.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Awaiting resend from the Trading Partner' }),
    ).toBeVisible()
    await expect(canvas.getByText(/could not be parsed/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Retry' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Reprocess' })).toBeNull()
  },
})

export const ValidationFailure = meta.story({
  args: { id: validationFailure.id },
  async play({ canvasElement, canvas }) {
    await expect(
      await canvas.findByText('Segment 4 (DTM), element 1, component 2', { exact: false }),
    ).toBeVisible()
    await expect(canvasElement.querySelector('mark')).toHaveTextContent('20261341')
  },
})

export const OutboundValidationFailure = meta.story({
  args: { id: outboundValidationFailure.id },
  async play({ canvas }) {
    await expect(await canvas.findByText(/No Retry or Reprocess is available/)).toBeVisible()
  },
})

export const OutboundMappingFailure = meta.story({
  args: { id: outboundMappingFailure.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('This Run has not produced an Interchange yet.'),
    ).toBeVisible()
  },
})

export const Replaced = meta.story({
  args: { id: replaced.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Open the replacing Run' })).toBeVisible()
    await expect(canvas.getByText('Replaced by')).toBeVisible()
  },
})

export const Replacing = meta.story({
  args: { id: replacing.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Replaces')).toBeVisible()
  },
})

export const Processing = meta.story({
  args: { id: processing.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Running')).toBeVisible()
  },
})

export const LargeInterchange = meta.story({
  args: { id: bundled[97]!.id },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvasElement, canvas }) {
    await expect(await canvas.findByText(/Message 98, ORDERS/)).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-error-line]')).toHaveLength(1)
  },
})

export const NotFound = meta.story({
  args: { id: '30000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Run not found')).toBeVisible()
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
    await expect(canvas.getByText('Loading Run')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Run unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: mappingFailure.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Schritte' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reprocess' })).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: validationFailure.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Error' })).toBeVisible()
  },
})
