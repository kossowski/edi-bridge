import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { TradingPartnerDetailScreen } from '@/components/trading-partners/trading-partner-detail-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { tradingPartnerEndpoint } from '@edi-bridge/contracts'
import { createHandlers, createWorkspace, seedTradingPartners } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedTradingPartners.find((tradingPartner) => tradingPartner.name === name)!
}

const inProduction = seeded('Hansemarkt GmbH')

const readyForProduction = seeded('Spreewald Frische GmbH')

const awaitingContrl = seeded('Bodensee Handelshaus AG')

const withoutTraffic = seeded('Mainfranken Getränke GmbH')

const meta = preview.meta({
  title: 'Trading Partners/TradingPartnerDetailScreen',
  component: TradingPartnerDetailScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const InProduction = meta.story({
  args: { id: inProduction.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(await canvas.findByText('Hansemarkt SFTP inbox')).toBeVisible()
    const flows = within(canvas.getByRole('region', { name: 'Flows' }))
    await expect(await flows.findByText('Hansemarkt ORDERS inbound')).toBeVisible()
    await expect(await canvas.findByRole('link', { name: /View all .* Runs/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Switch to production' })).toBeNull()
  },
})

export const ReadyForProduction = meta.story({
  args: { id: readyForProduction.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Switch to production' })).toBeVisible()
  },
})

export const AwaitingContrl = meta.story({
  args: { id: awaitingContrl.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('You can switch to production once the CONTRL is received.'),
    ).toBeVisible()
  },
})

export const WithoutTraffic = meta.story({
  args: { id: withoutTraffic.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Runs for this Trading Partner yet.')).toBeVisible()
    await expect(canvas.getByText('No Flows for this Trading Partner yet.')).toBeVisible()
  },
})

export const WorkspaceWithoutGln = meta.story({
  args: { id: withoutTraffic.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { workspace: createWorkspace({ gln: null }) }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: "Record your company's GLN in Settings" }),
    ).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '10000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading Partner not found')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { id: inProduction.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnerEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Trading Partner')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: inProduction.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnerEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading Partner unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: readyForProduction.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('button', { name: 'Auf Produktion umstellen' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: awaitingContrl.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Onboarding' })).toBeVisible()
  },
})
