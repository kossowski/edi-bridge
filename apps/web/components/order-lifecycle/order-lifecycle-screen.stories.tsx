import { expect, userEvent, within } from 'storybook/test'

import { OrderLifecycleScreen } from '@/components/order-lifecycle/order-lifecycle-screen'
import { besideSidebar, darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
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

function documentLinks(step: HTMLElement) {
  return within(step).getAllByRole('link', { name: /open document from / })
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

export const UnavailableGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Order Lifecycle nicht verfügbar')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()
  },
})

export const UnavailableDark = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'error'))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Order Lifecycle unavailable')).toBeVisible()
  },
})

export const NoResult = meta.story({
  args: { businessReference: orderLifecycleReferences.noMatch },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Order Lifecycle found')).toBeVisible()
    await expect(canvas.getByText(/No Message carries the Business Reference 0000\./)).toBeVisible()
  },
})

export const NoResultGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.noMatch },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Kein Order Lifecycle gefunden')).toBeVisible()
    await expect(
      canvas.getByText(/Keine Message trägt die Business Reference 0000\./),
    ).toBeVisible()
  },
})

export const NoResultDark = meta.story({
  args: { businessReference: orderLifecycleReferences.noMatch },
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByText('No Order Lifecycle found')).toBeVisible()
  },
})

export const Full = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Hansemarkt GmbH',
    })

    await expect(within(timeline).queryByText('Open')).toBeNull()
    await expect(within(stepOf(timeline, 'ORDERS')).queryByText('Acknowledgement')).toBeNull()
    await expect(within(stepOf(timeline, 'DESADV')).getByText('Accepted')).toBeVisible()
    await expect(within(stepOf(timeline, 'INVOIC')).getByText('Accepted')).toBeVisible()
    await expect(within(stepOf(timeline, 'ORDERS')).getByText('Received')).toBeVisible()
    await expect(within(stepOf(timeline, 'INVOIC')).getByText('Received')).toBeVisible()
    await expect(
      within(stepOf(timeline, 'ORDERS')).getByRole('link', { name: /^Control reference / }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/documents\?view=transmissions&q=/))
    await expect(
      within(timeline).getAllByRole('link', { name: /open document from Hansemarkt GmbH/ }),
    ).toHaveLength(3)
  },
})

export const Partial = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', { name: 'Order Lifecycle with Rheinkauf eG' })

    await expect(within(stepOf(timeline, 'INVOIC')).getByText('No INVOIC yet.')).toBeVisible()
    await expect(within(stepOf(timeline, 'DESADV')).queryByText('Open')).toBeNull()
    await expect(within(stepOf(timeline, 'DESADV')).getByText('Pending')).toBeVisible()
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

    const alpenfrisch = canvas.getByRole('list', {
      name: 'Order Lifecycle with Alpenfrisch Märkte AG',
    })

    await expect(within(stepOf(alpenfrisch, 'DESADV')).getByText('Overdue')).toBeVisible()
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
    await expect(desadv.getByText('The document could not be translated')).toBeVisible()
    await expect(desadv.getAllByText('Acknowledgement')).toHaveLength(1)
    await expect(desadv.getByText('Rejected')).toBeVisible()
    await expect(desadv.getByRole('link', { name: /^Document [0-9a-f]{8}$/ })).toBeVisible()
    await expect(
      within(stepOf(timeline, 'INVOIC')).getByText('The document could not be delivered'),
    ).toBeVisible()
  },
})

export const German = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Noch keine INVOIC.')).toBeVisible()
    await expect(canvas.getByText('Ausstehend')).toBeVisible()
    await expect(canvas.getByRole('searchbox', { name: 'Business Reference' })).toHaveValue('4712')
  },
})

export const Dark = meta.story({
  args: { businessReference: orderLifecycleReferences.failures },
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 2, name: 'Elbtal Warenhaus KG' }),
    ).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { businessReference: orderLifecycleReferences.largeVolume },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Hansemarkt GmbH',
    })

    const desadv = stepOf(timeline, 'DESADV')
    const invoic = stepOf(timeline, 'INVOIC')

    await expect(within(desadv).getByText('34 Messages')).toBeVisible()
    await expect(within(desadv).getByText('Latest 5 of 34')).toBeVisible()
    await expect(documentLinks(desadv)).toHaveLength(5)
    await expect(documentLinks(invoic)).toHaveLength(5)

    const desadvSummary = within(
      within(desadv).getByRole('list', { name: 'Acknowledgements of the DESADV Messages' }),
    )

    await expect(desadvSummary.getByText('Accepted')).toBeVisible()
    await expect(desadvSummary.getByText('Overdue')).toBeVisible()
    await expect(desadvSummary.getByText('Pending')).toBeVisible()
    await expect(
      within(invoic).getByRole('list', { name: 'Acknowledgements of the INVOIC Messages' }),
    ).toHaveTextContent('Rejected')

    const showAll = within(desadv).getByRole('button', { name: 'Show all 34 DESADV Messages' })

    await expect(showAll).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(showAll)
    await expect(documentLinks(desadv)).toHaveLength(34)
    await expect(showAll).toHaveAttribute('aria-expanded', 'true')
    await expect(showAll).toHaveAccessibleName('Show the latest 5')
    await expect(documentLinks(invoic)).toHaveLength(5)
  },
})

export const LargeVolumeGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.largeVolume },
  decorators: [besideSidebar, german],
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle mit Hansemarkt GmbH',
    })

    const desadv = within(stepOf(timeline, 'DESADV'))

    await expect(desadv.getByText('Neueste 5 von 34')).toBeVisible()
    await expect(
      desadv.getByRole('list', { name: 'Acknowledgements der DESADV-Messages' }),
    ).toHaveTextContent('Überfällig')
    await expect(
      within(stepOf(timeline, 'INVOIC')).getByRole('list', {
        name: 'Acknowledgements der INVOIC-Messages',
      }),
    ).toHaveTextContent('Abgelehnt')
    await userEvent.click(desadv.getByRole('button', { name: 'Alle 34 DESADV-Messages anzeigen' }))
    await expect(
      desadv.getByRole('button', { name: 'Nur die neuesten 5 anzeigen' }),
    ).toHaveAttribute('aria-expanded', 'true')
  },
})

export const LargeVolumeDark = meta.story({
  args: { businessReference: orderLifecycleReferences.largeVolume },
  beforeEach: darkMode,
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Hansemarkt GmbH',
    })

    for (const messageType of ['DESADV', 'INVOIC']) {
      await userEvent.click(
        within(stepOf(timeline, messageType)).getByRole('button', { name: /^Show all / }),
      )
    }

    await expect(documentLinks(stepOf(timeline, 'INVOIC'))).toHaveLength(30)
  },
})

export const LargeVolumeCollapse = meta.story({
  ...mobile,
  args: { businessReference: orderLifecycleReferences.largeVolume },
  async play({ canvas }) {
    const timeline = await canvas.findByRole('list', {
      name: 'Order Lifecycle with Hansemarkt GmbH',
    })

    const desadv = stepOf(timeline, 'DESADV')
    const toggle = within(desadv).getByRole('button', { name: 'Show all 34 DESADV Messages' })

    await userEvent.click(toggle)
    toggle.scrollIntoView({ block: 'end' })
    await userEvent.click(toggle)

    const { top, bottom } = toggle.getBoundingClientRect()

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveFocus()
    await expect(top).toBeGreaterThanOrEqual(0)
    await expect(bottom).toBeLessThanOrEqual(window.innerHeight)

    await userEvent.click(toggle)
    toggle.scrollIntoView({ block: 'end' })
    await userEvent.keyboard('{Enter}')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveFocus()
    await expect(toggle.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  },
})
