import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { AppSearch } from '@/components/app-search'
import { QueryProvider } from '@/components/query-provider'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, desktop, german, laptop, mobile, tablet } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { runsEndpoint, tradingPartnersEndpoint } from '@edi-bridge/contracts'
import {
  createRuns,
  createTradingPartners,
  orderLifecycleHandler,
  orderLifecycleReferences,
  runsHandler,
  sandboxAdminSession,
  seedSession,
  seedTradingPartners,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'

import preview from '../.storybook/preview'

const runs = createRuns({ count: 50 })

const searchButton = 'Search orders, partners, documents, pages…'

async function openPalette(canvas: { findByRole: typeof screen.findByRole }, name = searchButton) {
  await userEvent.click(await canvas.findByRole('button', { name }))

  const dialog = await screen.findByRole('dialog')

  await waitFor(() => expect(dialog).toBeVisible())

  return within(dialog)
}

const meta = preview.meta({
  title: 'Shell/AppSearch',
  component: AppSearch,
  parameters: { a11y: { context: 'body' }, nextjs: { navigation: { pathname: '/' } } },
  decorators: [
    (Story) => (
      <div className="flex justify-end p-4">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(
      ...sessionHandlers(sandboxAdminSession),
      ...tradingPartnerHandlers(apiUrl),
      runsHandler(apiUrl, runs),
      orderLifecycleHandler(apiUrl),
    )
  },
})

export const Closed = meta.story({
  async play({ canvas }) {
    const button = await canvas.findByRole('button', { name: searchButton })

    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K')
    await expect(canvas.getByText('Ctrl K')).toBeVisible()
  },
})

export const Results = meta.story({
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await expect(screen.getByRole('dialog', { name: 'Search' })).toHaveAccessibleDescription(
      'Find an order, a trading partner, a document or a page',
    )
    await expect(await dialog.findByRole('group', { name: 'Trading partners' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Documents' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Pages' })).toBeVisible()
    await expect(dialog.queryByRole('group', { name: 'Orders' })).toBeNull()
    await expect(dialog.queryByRole('option', { name: /^Operator area/ })).toBeNull()
    await expect(dialog.queryByText('Run')).toBeNull()

    await userEvent.type(dialog.getByRole('combobox'), 'alpenfrisch')
    await waitFor(() =>
      expect(dialog.queryByRole('option', { name: /^Hansemarkt GmbH/ })).toBeNull(),
    )
    const partner = seedTradingPartners.find(({ name }) => name === 'Alpenfrisch Märkte AG')!
    await userEvent.click(dialog.getByRole('option', { name: /^Alpenfrisch Märkte AG/ }))
    await expect(getRouter().push).toHaveBeenCalledWith(`/trading-partners/${partner.id}`)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
})

export const KeyboardShortcut = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('button', { name: searchButton })
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = within(await screen.findByRole('dialog', { name: 'Search' }))

    await expect(dialog.getByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('code translations')
    await waitFor(() => expect(dialog.getAllByRole('option')).toHaveLength(1))
    await userEvent.keyboard('{Enter}')
    await expect(getRouter().push).toHaveBeenCalledWith('/lookup-tables')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
})

export const Order = meta.story({
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await userEvent.type(dialog.getByRole('combobox'), orderLifecycleReferences.full)

    const order = await dialog.findByRole('option', {
      name: new RegExp(`^Order ${orderLifecycleReferences.full}`),
    })

    await expect(within(order).getByText('Hansemarkt GmbH')).toBeVisible()
    await waitFor(() => expect(order).toHaveAttribute('aria-selected', 'true'))
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
    await userEvent.keyboard('{Enter}')
    await expect(getRouter().push).toHaveBeenCalledWith(
      `/order-lifecycle?businessReference=${orderLifecycleReferences.full}`,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
})

export const OrderBesideOtherResults = meta.story({
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await userEvent.type(dialog.getByRole('combobox'), orderLifecycleReferences.failures)

    const orders = await dialog.findByRole('group', { name: 'Orders' })

    await expect(within(orders).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
    await userEvent.click(within(orders).getAllByRole('option')[0]!)
    await expect(getRouter().push).toHaveBeenCalledWith(
      `/order-lifecycle?businessReference=${orderLifecycleReferences.failures}`,
    )
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () => delay('infinite')),
      http.get(`${apiUrl}${runsEndpoint.path}`, () => delay('infinite')),
    )
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await expect(await dialog.findByText('Searching…')).toBeVisible()
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
    await expect(dialog.getByRole('option', { name: /^Home/ })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }), runsHandler(apiUrl, []))
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await expect(await dialog.findByRole('option', { name: /^Home/ })).toBeVisible()
    await userEvent.type(dialog.getByRole('combobox'), 'nordpol')
    await expect(await dialog.findByText('Nothing found.')).toBeVisible()
  },
})

export const NoOrder = meta.story({
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await userEvent.type(dialog.getByRole('combobox'), orderLifecycleReferences.noMatch)
    await expect(await dialog.findByText('Nothing found.')).toBeVisible()
    await expect(dialog.queryByRole('group', { name: 'Orders' })).toBeNull()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Unavailable' }, { status: 500 }),
      ),
      http.get(`${apiUrl}${runsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Unavailable' }, { status: 500 }),
      ),
      orderLifecycleHandler(apiUrl, 'error'),
    )
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await expect(
      await dialog.findByRole('option', { name: /^Trading partners could not be loaded/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('option', { name: /^Documents could not be loaded/ }),
    ).toBeVisible()
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
    await userEvent.type(dialog.getByRole('combobox'), orderLifecycleReferences.full)
    await expect(
      await dialog.findByRole('option', { name: /^Orders could not be searched/ }),
    ).toBeVisible()
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
  },
})

export const OrderUnavailable = meta.story({
  decorators: [
    (Story) => (
      <QueryProvider>
        <Story />
      </QueryProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await dialog.findByRole('group', { name: 'Trading partners' })
    await userEvent.type(dialog.getByRole('combobox'), orderLifecycleReferences.full)
    await expect(
      await dialog.findByRole(
        'option',
        { name: /^Orders could not be searched/ },
        { timeout: 1500 },
      ),
    ).toBeVisible()
    await expect(dialog.queryByText('Searching…')).toBeNull()
    await expect(dialog.queryByText('Nothing found.')).toBeNull()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...tradingPartnerHandlers(apiUrl, { tradingPartners: createTradingPartners({ count: 400 }) }),
      runsHandler(apiUrl, createRuns({ count: 2_000 })),
    )
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)
    const tradingPartners = await dialog.findByRole('group', { name: 'Trading partners' })

    await expect(within(tradingPartners).getAllByRole('option')).toHaveLength(400)
    await expect(
      within(dialog.getByRole('group', { name: 'Documents' })).getAllByRole('option'),
    ).toHaveLength(50)
  },
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await userEvent.type(dialog.getByRole('combobox'), 'area')
    await userEvent.click(await dialog.findByRole('option', { name: /^Operator area/ }))
    await expect(getRouter().push).toHaveBeenCalledWith('/operator')
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    const dialog = await openPalette(canvas, 'Aufträge, Handelspartner, Belege, Seiten suchen …')

    await expect(screen.getByRole('dialog', { name: 'Suche' })).toBeVisible()
    await expect(await dialog.findByRole('group', { name: 'Handelspartner' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Belege' })).toBeVisible()
    await expect(dialog.getByRole('option', { name: /^Einstellungen/ })).toBeVisible()
    await userEvent.type(dialog.getByRole('combobox'), 'nordpol')
    await expect(await dialog.findByText('Nichts gefunden.')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    const dialog = await openPalette(canvas)

    await expect(await dialog.findByRole('group', { name: 'Documents' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: searchButton })).toBeVisible()
    await expect(canvas.getByText('Ctrl K')).not.toBeVisible()

    const dialog = await openPalette(canvas)

    await expect(await dialog.findByRole('group', { name: 'Trading partners' })).toBeVisible()
  },
})

export const Tablet = meta.story({
  ...tablet,
  async play({ canvas }) {
    const button = await canvas.findByRole('button', { name: searchButton })

    await expect(button.getBoundingClientRect().width).toBe(40)
    await expect(canvas.getByText('Ctrl K')).not.toBeVisible()
  },
})

export const Laptop = meta.story({
  ...laptop,
  decorators: [german],
  async play({ canvas }) {
    const name = 'Aufträge, Handelspartner, Belege, Seiten suchen …'
    const button = await canvas.findByRole('button', { name })
    const label = within(button).getByText(name).getBoundingClientRect()

    await expect(button.getBoundingClientRect().width).toBe(320)
    await expect(label.height).toBeLessThanOrEqual(20)
    await expect(label.right).toBeLessThanOrEqual(button.getBoundingClientRect().right)
    await expect(canvas.getByText('Ctrl K')).toBeVisible()
  },
})

export const Desktop = meta.story({
  ...desktop,
  async play({ canvas }) {
    const button = await canvas.findByRole('button', { name: searchButton })
    const label = within(button).getByText(searchButton).getBoundingClientRect()

    await expect(button.getBoundingClientRect().width).toBe(384)
    await expect(label.height).toBeLessThanOrEqual(20)
    await expect(canvas.getByText('Ctrl K')).toBeVisible()
  },
})
