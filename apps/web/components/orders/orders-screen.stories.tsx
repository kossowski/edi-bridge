import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OrdersScreen } from '@/components/orders/orders-screen'
import {
  darkMode,
  german,
  goBack,
  goForward,
  mobile,
  withMemoryHistory,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { orderLifecycleListHandler, orderLifecycleReferences } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const ordersAt = (query: Record<string, string>) => ({
  nextjs: { navigation: { pathname: '/orders', query } },
})

const meta = preview.meta({
  title: 'Orders/OrdersScreen',
  component: OrdersScreen,
  parameters: { layout: 'fullscreen', ...ordersAt({}) },
  beforeEach({ msw }) {
    msw.use(orderLifecycleListHandler(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ orders?$/)).toBeVisible()

    const list = await canvas.findByRole('list', { name: 'Orders, latest activity first' })

    await expect(
      within(list).getByRole('link', { name: `Order ${orderLifecycleReferences.full}` }),
    ).toHaveAttribute('href', `/orders/${orderLifecycleReferences.full}`)
    await expect(canvas.getByRole('button', { name: /^All \d+$/, pressed: true })).toBeVisible()
    await expect(
      within(list).getAllByRole('list', { name: 'Progress from purchase order to invoice' })[0],
    ).toBeVisible()
  },
})

export const FilteredByStatus = meta.story({
  parameters: ordersAt({ status: 'needs-attention' }),
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ orders?$/)).toBeVisible()

    const list = await canvas.findByRole('list', { name: 'Orders, latest activity first' })

    await expect(
      canvas.getByRole('button', { name: /^Needs attention \d+$/, pressed: true }),
    ).toBeVisible()
    await expect(within(list).getAllByText('Needs attention').length).toBeGreaterThan(0)
    await expect(within(list).queryByText('Done')).toBeNull()
  },
})

export const ReceiptConfirmationNotSent = meta.story({
  parameters: ordersAt({ q: orderLifecycleReferences.partial }),
  async play({ canvas }) {
    const list = await canvas.findByRole('list', { name: 'Orders, latest activity first' })

    const link = await within(list).findByRole('link', {
      name: `Order ${orderLifecycleReferences.partial}`,
    })

    const row = within(link.closest('li')!)

    await expect(row.getByText('Needs attention')).toBeVisible()
    await expect(row.getByText('Purchase order: Needs attention')).toBeInTheDocument()
    await expect(row.queryByText(/: Done$/)).toBeNull()
  },
})

export const BackUndoesStatusFilter = meta.story({
  decorators: [withMemoryHistory],
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: /^Needs attention \d+$/ }))
    await expect(
      await canvas.findByRole('button', { name: /^Needs attention \d+$/, pressed: true }),
    ).toBeVisible()

    goBack()

    await expect(
      await canvas.findByRole('button', { name: /^All \d+$/, pressed: true }),
    ).toBeVisible()
  },
})

export const BackUndoesWholeSearch = meta.story({
  parameters: ordersAt({ status: 'needs-attention' }),
  decorators: [withMemoryHistory],
  async play({ canvas }) {
    await canvas.findByRole('button', { name: /^Needs attention \d+$/, pressed: true })
    // Each keystroke waits out the search delay, so every one reaches the URL.
    await userEvent.type(canvas.getByRole('searchbox'), 'zz', { delay: 400 })
    await expect(await canvas.findByText('No orders match')).toBeVisible()

    goBack()

    await waitFor(() => expect(canvas.getByRole('searchbox')).toHaveValue(''))
    await expect(
      canvas.getByRole('button', { name: /^Needs attention \d+$/, pressed: true }),
    ).toBeVisible()
  },
})

export const SearchAfterForwardKeepsEntry = meta.story({
  parameters: ordersAt({ status: 'needs-attention' }),
  decorators: [withMemoryHistory],
  async play({ canvas }) {
    const searchbox = await canvas.findByRole('searchbox')

    await userEvent.type(searchbox, 'P')
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledOnce())

    goBack()
    await waitFor(() => expect(searchbox).toHaveValue(''))
    goForward()
    await waitFor(() => expect(searchbox).toHaveValue('P'))

    await userEvent.type(searchbox, 'z')
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(2))

    goBack()

    await waitFor(() => expect(searchbox).toHaveValue('P'))
  },
})

export const BackAfterSearchUndone = meta.story({
  decorators: [withMemoryHistory],
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: /^Needs attention \d+$/ }))
    await canvas.findByRole('button', { name: /^Needs attention \d+$/, pressed: true })

    const searchbox = canvas.getByRole('searchbox')

    await userEvent.type(searchbox, 'zz')
    await expect(await canvas.findByText('No orders match')).toBeVisible()
    await userEvent.type(searchbox, 'z')
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledOnce())
    await userEvent.clear(searchbox)
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledOnce())

    goBack()

    await expect(
      await canvas.findByRole('button', { name: /^All \d+$/, pressed: true }),
    ).toBeVisible()
  },
})

export const FirstPageReplacesEntry = meta.story({
  parameters: ordersAt({ page: '99' }),
  decorators: [withMemoryHistory],
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Go to the first page' }))

    await expect(
      await canvas.findByRole('list', { name: 'Orders, latest activity first' }),
    ).toBeVisible()
    await expect(getRouter().replace).toHaveBeenCalledOnce()
    await expect(getRouter().push).not.toHaveBeenCalled()
  },
})

export const NoResult = meta.story({
  parameters: ordersAt({ q: 'PO-none' }),
  async play({ canvas }) {
    await expect(await canvas.findByText('No orders match')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Show all orders' })).toBeVisible()
    await expect(canvas.getByRole('searchbox')).toHaveValue('PO-none')
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(orderLifecycleListHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No orders yet')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Show all orders' })).toBeNull()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(orderLifecycleListHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading orders')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(orderLifecycleListHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Orders unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(orderLifecycleListHandler(apiUrl, 'large'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('320 orders')).toBeVisible()
    await expect(canvas.getByText('Page 1 of 7')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ Aufträge?$/)).toBeVisible()
    await expect(
      await canvas.findByRole('list', { name: 'Aufträge, neueste Aktivität zuerst' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Handlungsbedarf \d+$/ })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ orders?$/)).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ orders?$/)).toBeVisible()
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

    const statusFilter = canvas.getByRole('group', { name: 'Status' })
    const chips = within(statusFilter).getAllByRole('button')

    await expect(statusFilter.closest('search')).toHaveAttribute('aria-label', 'Filter orders')
    await expect(chips).toHaveLength(5)

    for (const chip of chips) {
      const { left, right } = chip.getBoundingClientRect()

      await expect(left).toBeGreaterThanOrEqual(0)
      await expect(right).toBeLessThanOrEqual(window.innerWidth)
      await expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth)
    }
  },
})
