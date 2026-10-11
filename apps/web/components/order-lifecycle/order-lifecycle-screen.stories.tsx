import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { OrderLifecycleScreen } from '@/components/order-lifecycle/order-lifecycle-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { orderLifecycleHandler, orderLifecycleReferences } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Order Lifecycle/OrderLifecycleScreen',
  component: OrderLifecycleScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl))
  },
})

function stepOf(timeline: HTMLElement, messageType: string) {
  return within(timeline).getByRole('heading', { level: 3, name: messageType }).closest('li')!
}

export const Initial = meta.story({
  async play({ canvas }) {
    await expect(canvas.getByRole('searchbox', { name: 'Business Reference' })).toHaveValue('')
    await expect(canvas.getByText('Search for a Business Reference')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(
      canvas.getByText(`Loading the Order Lifecycle for ${orderLifecycleReferences.full}`),
    ).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Order Lifecycle unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NoResult = meta.story({
  args: { businessReference: orderLifecycleReferences.noMatch },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Order Lifecycle found')).toBeVisible()
    await expect(canvas.getByText(/No Message carries the Business Reference 0000\./)).toBeVisible()
  },
})

export const Full = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Hansemarkt GmbH',
    })

    await expect(within(timeline).queryByText('Open')).toBeNull()
    await expect(within(stepOf(timeline, 'ORDERS')).getByText('Received')).toBeVisible()
    await expect(within(stepOf(timeline, 'INVOIC')).getByText('Received')).toBeVisible()
    await expect(
      within(stepOf(timeline, 'ORDERS')).getByRole('link', { name: /^Control reference / }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/interchanges\//))
    await expect(
      within(timeline).getAllByRole('link', { name: /open Run from Hansemarkt GmbH/ }),
    ).toHaveLength(3)
  },
})

export const Partial = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', { name: 'Order Lifecycle with Rheinkauf eG' })

    await expect(within(stepOf(timeline, 'INVOIC')).getByText('No INVOIC yet.')).toBeVisible()
    await expect(within(stepOf(timeline, 'DESADV')).queryByText('Open')).toBeNull()
  },
})

export const TwoTradingPartners = meta.story({
  args: { businessReference: orderLifecycleReferences.multiPartner },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('2 Order Lifecycles for the Business Reference 4713'),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Alpenfrisch Märkte AG' }),
    ).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 2, name: 'Hansemarkt GmbH' })).toBeVisible()
  },
})

export const Failures = meta.story({
  args: { businessReference: orderLifecycleReferences.failures },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Elbtal Warenhaus KG',
    })

    const desadv = within(stepOf(timeline, 'DESADV'))

    await expect(desadv.getByText('2 Messages')).toBeVisible()
    await expect(desadv.getByText('Mapping')).toBeVisible()
    await expect(desadv.getByRole('link', { name: /^Run [0-9a-f]{8}$/ })).toBeVisible()
    await expect(within(stepOf(timeline, 'INVOIC')).getByText('Delivery')).toBeVisible()
  },
})

export const German = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(await canvas.findByText('Noch keine INVOIC.')).toBeVisible()
    await expect(canvas.getByRole('searchbox', { name: 'Business Reference' })).toHaveValue('4712')
  },
})

export const Dark = meta.story({
  args: { businessReference: orderLifecycleReferences.failures },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 2, name: 'Elbtal Warenhaus KG' }),
    ).toBeVisible()
  },
})
