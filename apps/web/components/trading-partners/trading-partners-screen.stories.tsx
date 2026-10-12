import { delay, http, HttpResponse } from 'msw'
import { expect, within } from 'storybook/test'

import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, german } from '@/components/story-helpers'
import { TradingPartnersScreen } from '@/components/trading-partners/trading-partners-screen'
import { apiUrl } from '@/lib/api/config'
import { tradingPartnersEndpoint } from '@edi-bridge/contracts'
import {
  createTradingPartners,
  tradingPartnerActivityHandlers,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Trading Partners/TradingPartnersScreen',
  component: TradingPartnersScreen,
  parameters: { layout: 'fullscreen' },
})

async function cardOf(canvasElement: HTMLElement, name: string) {
  const heading = await within(canvasElement).findByRole('heading', { name })
  const card = heading.closest('[data-slot="card"]')

  return within(card instanceof HTMLElement ? card : heading)
}

export const Default = meta.story({
  async play({ canvas, canvasElement }) {
    const live = await cardOf(canvasElement, 'Hansemarkt GmbH')

    await expect(live.getByText('Live')).toBeVisible()
    await expect(live.getByText('Set up and exchanging real documents')).toBeVisible()
    await expect(live.queryByRole('progressbar')).toBeNull()
    await expect(live.getByRole('link')).toHaveAccessibleName('Open partner Hansemarkt GmbH')
    await expect(live.getByRole('link')).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/trading-partners\/[\da-f-]+$/),
    )
    await expect(live.queryByRole('button')).toBeNull()
    await expect(live.getByText('Documents today')).toBeVisible()
    await expect(live.getByText('Open problems')).toBeVisible()
    await expect(live.getByText('Last activity')).toBeVisible()

    const ready = await cardOf(canvasElement, 'Spreewald Frische GmbH')

    await expect(ready.getByText('Testing')).toBeVisible()
    await expect(ready.getByText('Next: Go live')).toBeVisible()
    await expect(ready.getByRole('progressbar', { name: 'Setup' })).toHaveAttribute(
      'aria-valuetext',
      '6 of 7 steps',
    )

    const withoutGln = await cardOf(canvasElement, 'Ostsee Feinkost GmbH')

    await expect(withoutGln.getByText('GLN not added yet')).toBeVisible()
    await expect(withoutGln.getByText("Next: Add the partner's GLN")).toBeVisible()

    await expect(canvas.getByText('8 trading partners')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Add trading partner' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No trading partners yet')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'Add your first trading partner' }),
    ).toHaveAttribute('href', '/trading-partners/new')
    await expect(canvas.queryByRole('link', { name: 'Add trading partner' })).toBeNull()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, async () => {
        await delay('infinite')
      }),
      ...tradingPartnerActivityHandlers(apiUrl, 'loading'),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading trading partners')).toBeInTheDocument()
    await expect(canvas.getByRole('list', { name: 'Trading partners' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
})

export const PartnersUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading partners unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Add trading partner' })).toBeNull()
  },
})

export const ActivityUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerActivityHandlers(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading partners unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(
      // Same count and seed as the large workspace activity, so the activity matches these partners.
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: createTradingPartners({ count: 240, seed: 16 }),
      }),
      ...tradingPartnerActivityHandlers(apiUrl, 'large'),
    )
  },
  // Contrast is checked on the same cards in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('240 trading partners', {}, { timeout: 10_000 }),
    ).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: /^Open partner / })).toHaveLength(240)
    await expect(canvas.queryAllByText('None yet').length).toBeLessThan(240)
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvasElement }) {
    const live = await cardOf(canvasElement, 'Hansemarkt GmbH')

    await expect(live.getByRole('link')).toHaveAccessibleName('Partner öffnen Hansemarkt GmbH')
    await expect(live.getByText('Belege heute')).toBeVisible()

    const ready = await cardOf(canvasElement, 'Spreewald Frische GmbH')

    await expect(ready.getByText('Testbetrieb')).toBeVisible()
    await expect(ready.getByText('Nächster Schritt: Live schalten')).toBeVisible()
  },
})

export const GermanEmpty = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Ersten Handelspartner hinzufügen' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Hansemarkt GmbH' })).toBeVisible()
  },
})

export const DarkEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No trading partners yet')).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        await canvas.findByRole('link', { name: 'Open partner Hansemarkt GmbH' }),
      ).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'Add trading partner' })).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...tradingPartnerHandlers(apiUrl, { tradingPartners: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText('Trading partners appear here once an Admin adds one.'),
      ).toBeVisible()
      await expect(
        canvas.queryByRole('link', { name: 'Add your first trading partner' }),
      ).toBeNull()
    },
  }),
})
