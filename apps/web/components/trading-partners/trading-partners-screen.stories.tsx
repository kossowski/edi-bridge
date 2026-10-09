import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { TradingPartnersScreen } from '@/components/trading-partners/trading-partners-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { tradingPartnersEndpoint } from '@edi-bridge/contracts'
import { createTradingPartners, tradingPartnersHandler } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Trading Partners/TradingPartnersScreen',
  component: TradingPartnersScreen,
  parameters: { layout: 'fullscreen' },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(canvas.getByText('Next: CONTRL received')).toBeVisible()
    await expect(canvas.getByText('Next: Test Interchange sent')).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(tradingPartnersHandler(apiUrl, []))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Trading Partners yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Trading Partners')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading Partners unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(tradingPartnersHandler(apiUrl, createTradingPartners({ count: 400 })))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('400 Trading Partners')).toBeVisible()
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
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Zeichensatz' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Hansemarkt GmbH' })).toBeVisible()
  },
})
