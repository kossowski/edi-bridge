import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { InterchangeScreen } from '@/components/interchanges/interchange-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { interchangeEndpoint, type RunSummary } from '@edi-bridge/contracts'
import {
  createRun,
  interchangeIdOf,
  runDetailHandlers,
  seedFlows,
  seedTradingPartners,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const partner = seedTradingPartners[1]!

const ordersFlow = seedFlows.find(
  ({ tradingPartnerId, messageType }) =>
    tradingPartnerId === partner.id && messageType === 'ORDERS',
)!

function bundle(count: number, offset: number, receivedAt: string) {
  return Array.from({ length: count }, (_, index): RunSummary => {
    const run = {
      id: `40000000-0000-4000-8000-${String(offset + index).padStart(12, '0')}`,
      receivedAt,
      tradingPartner: partner,
      messageType: 'ORDERS',
      flow: { id: ordersFlow.id, name: ordersFlow.name },
      manualSubmission: false,
    } as const

    return index % 4 === 1
      ? createRun({ ...run, status: 'failed', failureStage: 'mapping' })
      : createRun({ ...run, status: 'delivered', failureStage: null })
  })
}

const small = bundle(4, 1, '2026-10-08T07:00:00.000Z')

const large = bundle(250, 100, '2026-10-08T06:00:00.000Z')

const meta = preview.meta({
  title: 'Interchanges/InterchangeScreen',
  component: InterchangeScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...runDetailHandlers(apiUrl, { runs: [...small, ...large] }))
  },
})

export const Default = meta.story({
  args: { id: interchangeIdOf(small[0]!) },
  async play({ canvas }) {
    await expect(await canvas.findByText('This Interchange produced 4 Runs.')).toBeVisible()
    await expect(canvas.getAllByRole('row')).toHaveLength(5)
  },
})

export const LargeVolume = meta.story({
  args: { id: interchangeIdOf(large[0]!) },
  async play({ canvas }) {
    await expect(await canvas.findByText('This Interchange produced 250 Runs.')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '40000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Interchange not found')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { id: '40000000-0000-4000-8000-0000000000ff' },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${interchangeEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Interchange')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: '40000000-0000-4000-8000-0000000000ff' },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${interchangeEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Interchange unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: interchangeIdOf(small[0]!) },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(await canvas.findByText('Dieses Interchange hat 4 Runs erzeugt.')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: interchangeIdOf(small[0]!) },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('This Interchange produced 4 Runs.')).toBeVisible()
  },
})
