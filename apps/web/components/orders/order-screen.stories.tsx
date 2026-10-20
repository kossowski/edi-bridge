import { expect, fn, userEvent, within } from 'storybook/test'

import type { ReactRenderer, StoryContext } from '@storybook/nextjs-vite'
import type { BeforeEach } from 'storybook/internal/csf'

import { OrderScreen } from '@/components/orders/order-screen'
import {
  besideSidebar,
  darkMode,
  expectNoPageScroll,
  german,
  mobile,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { acknowledgementNotSentReasons } from '@edi-bridge/contracts'
import {
  orderLifecycleHandler,
  orderLifecycleReferences,
  seedOrderLifecycles,
} from '@edi-bridge/mocks'

import type { OrderLifecycle } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Orders/OrderScreen',
  component: OrderScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl))
  },
})

function timelineOf(canvasElement: HTMLElement, tradingPartner: string) {
  return within(canvasElement).findByRole('list', {
    name: `Documents with ${tradingPartner}, from purchase order to invoice`,
  })
}

function stepOf(timeline: HTMLElement, name: string) {
  return within(timeline)
    .getByRole('heading', { level: 4, name: new RegExp(`^${name}`) })
    .closest('li')!
}

const writeText = fn<(text: string) => Promise<void>>(() => Promise.resolve())

function stubClipboard() {
  writeText.mockClear()
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  }
}

export const Complete = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { level: 3, name: 'Everything for this order is done' }),
    ).toBeVisible()
    await expect(canvas.getByText('3 of 3 documents done', { exact: false })).toBeVisible()

    const timeline = await timelineOf(canvasElement, 'Hansemarkt GmbH')

    await expect(within(stepOf(timeline, 'Dispatch advice')).getByText('Accepted')).toBeVisible()
    await expect(
      within(timeline).getAllByRole('link', { name: /^(Purchase order|Dispatch advice|Invoice) / }),
    ).toHaveLength(3)
    await expect(canvas.getByRole('link', { name: 'Hansemarkt GmbH' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/trading-partners\//),
    )
  },
})

export const ReceiptConfirmationPendingBesideNotSent = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'Rheinkauf eG got no receipt confirmation for the purchase order',
      }),
    ).toBeVisible()
    await expect(canvas.getByText('0 of 3 documents done', { exact: false })).toBeVisible()

    const timeline = await timelineOf(canvasElement, 'Rheinkauf eG')
    const orders = within(stepOf(timeline, 'Purchase order'))
    const desadv = within(stepOf(timeline, 'Dispatch advice'))

    await expect(orders.getByText('Needs attention')).toBeVisible()
    await expect(orders.queryByText('Done')).not.toBeInTheDocument()
    await expect(desadv.getByText('Waiting for partner')).toBeVisible()
    await expect(desadv.getByText('Pending')).toBeVisible()
    await expect(desadv.getByText('Waiting 3 h — limit 24 h')).toBeVisible()
    await expect(within(stepOf(timeline, 'Invoice')).getByText('Not yet')).toBeVisible()
    await expect(within(stepOf(timeline, 'Invoice')).getByText('No invoice yet.')).toBeVisible()
  },
})

export const ReceiptConfirmationNotSentVerdictGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'Rheinkauf eG hat für die Bestellung keine Empfangsbestätigung erhalten',
      }),
    ).toBeVisible()
    await expect(canvas.getAllByText('Handlungsbedarf').length).toBeGreaterThan(0)
    await expect(canvas.queryByText('Erledigt')).not.toBeInTheDocument()
  },
})

export const ReceiptConfirmationNotSent = meta.story({
  args: { businessReference: orderLifecycleReferences.partial },
  async play({ canvasElement }) {
    const orders = within(stepOf(await timelineOf(canvasElement, 'Rheinkauf eG'), 'Purchase order'))

    await expect(orders.getByText('Not sent')).toBeVisible()
    await expect(
      orders.getByText(
        'Rheinkauf eG got no receipt confirmation for this purchase order, because the header of the transmission from Rheinkauf eG cannot be repeated in a valid receipt confirmation.',
        { exact: false },
      ),
    ).toBeVisible()
    await expect(
      orders.getByText('Ask Rheinkauf eG to check the header of its transmissions.', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(orders.queryByRole('link', { name: /Rheinkauf eG/ })).not.toBeInTheDocument()
  },
})

function withEveryNotSentReason(lifecycle: OrderLifecycle): OrderLifecycle {
  const orders = lifecycle.messages.find(({ messageType }) => messageType === 'ORDERS')
  const interchange = orders?.interchange

  if (orders === undefined || interchange == null) {
    throw new Error(`Lifecycle ${lifecycle.businessReference} has no received ORDERS`)
  }

  return {
    ...lifecycle,
    messages: acknowledgementNotSentReasons.map((notSentReason) => ({
      ...orders,
      run: { ...orders.run, id: crypto.randomUUID() },
      interchange: { ...interchange, notSentReason },
    })),
  }
}

const everyNotSentReason = {
  args: { businessReference: orderLifecycleReferences.partial },
  beforeEach: (({ msw }: StoryContext) => {
    msw.use(
      orderLifecycleHandler(
        apiUrl,
        seedOrderLifecycles()
          .orderLifecycles.filter(
            ({ businessReference }) => businessReference === orderLifecycleReferences.partial,
          )
          .map(withEveryNotSentReason),
      ),
    )
  }) satisfies BeforeEach<ReactRenderer>,
}

export const EveryNotSentReason = meta.story({
  ...everyNotSentReason,
  async play({ canvasElement }) {
    const orders = within(stepOf(await timelineOf(canvasElement, 'Rheinkauf eG'), 'Purchase order'))

    await expect(orders.getAllByText('Not sent')).toHaveLength(4)
    await expect(
      orders.getByText(/because no document route sends documents to Rheinkauf eG/),
    ).toBeVisible()
    await expect(
      orders.getByRole('link', { name: 'Add a document route to Rheinkauf eG' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/trading-partners\/[^/?]+\?tab=documents$/))
    await expect(
      orders.getByText(/because the document routes to Rheinkauf eG use different connections/),
    ).toBeVisible()
    await expect(
      orders.getByRole('link', { name: 'document routes of Rheinkauf eG' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/trading-partners\/[^/?]+\?tab=documents$/))
    await expect(orders.getByText(/because your company's GLN is missing/)).toBeVisible()
    await expect(orders.getByRole('link', { name: "Record your company's GLN" })).toHaveAttribute(
      'href',
      '/settings',
    )
    await expect(
      orders.getByText(
        /because the header of the transmission from Rheinkauf eG cannot be repeated/,
      ),
    ).toBeVisible()
  },
})

export const ReceiptConfirmationNotSentGerman = meta.story({
  ...everyNotSentReason,
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findAllByText('Nicht gesendet')).toHaveLength(4)
    await expect(
      canvas.getByText(
        /Rheinkauf eG hat für diese Bestellung keine Empfangsbestätigung erhalten, weil kein Belegweg Belege an Rheinkauf eG sendet./,
      ),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        /weil sich der Kopf der Übertragung von Rheinkauf eG nicht in einer gültigen Empfangsbestätigung wiederholen lässt\. Bitten Sie Rheinkauf eG, den Kopf der Übertragungen zu prüfen\./,
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'GLN Ihres Unternehmens' })).toBeVisible()
  },
})

export const TwoTradingPartnersWithOverdue = meta.story({
  beforeEach: stubClipboard,
  args: { businessReference: orderLifecycleReferences.multiPartner },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByText('This order number is used with 2 trading partners.', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', {
        level: 3,
        name: 'Alpenfrisch Märkte AG has not confirmed the dispatch advice',
      }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', {
        level: 3,
        name: 'The dispatch advice was sent to Hansemarkt GmbH before receipt confirmations were tracked',
      }),
    ).toBeVisible()

    for (const tradingPartner of ['Alpenfrisch Märkte AG', 'Hansemarkt GmbH']) {
      await expect(
        within(canvas.getByRole('region', { name: tradingPartner })).getByRole('heading', {
          level: 2,
          name: tradingPartner,
        }),
      ).toBeVisible()
    }

    const desadv = within(
      stepOf(await timelineOf(canvasElement, 'Alpenfrisch Märkte AG'), 'Dispatch advice'),
    )

    await expect(desadv.getByText('Overdue')).toBeVisible()
    await expect(desadv.getByText('Waiting 10 h — limit 4 h')).toBeVisible()
    await expect(desadv.getByRole('link', { name: 'receipt confirmation' })).toBeVisible()

    const ask = desadv.getByRole('button', { name: 'Ask partner' })

    await expect(ask).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(ask)
    await expect(ask).toHaveAttribute('aria-expanded', 'true')

    const message = desadv.getByRole('textbox', { name: 'Message to Alpenfrisch Märkte AG' })

    await expect(message).toHaveAttribute('readonly')
    await expect(message).toHaveDisplayValue(
      /team,\n\nWe sent you the dispatch advice for order 4713/,
    )

    await userEvent.click(desadv.getByRole('button', { name: 'Copy message' }))
    await expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('dispatch advice for order 4713'),
    )
    await expect(desadv.getByText('Copied')).toBeVisible()
  },
})

export const FailuresWithReplacedRun = meta.story({
  args: { businessReference: orderLifecycleReferences.failures },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'The invoice to Elbtal Warenhaus KG could not be processed',
      }),
    ).toBeVisible()

    const timeline = await timelineOf(canvasElement, 'Elbtal Warenhaus KG')
    const desadv = within(stepOf(timeline, 'Dispatch advice'))
    const invoic = within(stepOf(timeline, 'Invoice'))

    await expect(desadv.getByText('Replaced')).toBeVisible()
    await expect(desadv.getByRole('link', { name: 'see the new document' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\da-f-]+$/),
    )
    await expect(desadv.getByText('Rejected')).toBeVisible()
    await expect(desadv.queryByRole('link', { name: 'See what to do' })).toBeNull()
    await expect(invoic.getByText('The document could not be delivered')).toBeVisible()
    await expect(invoic.getByRole('link', { name: 'See what to do' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/[\da-f-]+#what-to-do$/),
    )
  },
})

export const LargeVolume = meta.story({
  args: { businessReference: orderLifecycleReferences.largeVolume },
  async play({ canvas, canvasElement }) {
    const timeline = await timelineOf(canvasElement, 'Hansemarkt GmbH')
    const desadv = stepOf(timeline, 'Dispatch advice')
    const documentLinks = () => within(desadv).getAllByRole('link', { name: /^Dispatch advice / })

    await expect(
      within(desadv).getByText('Latest 5 of 34, plus 2 that need attention'),
    ).toBeVisible()
    await expect(documentLinks()).toHaveLength(7)
    await expect(
      within(stepOf(timeline, 'Invoice')).getAllByText('Rejected').length,
    ).toBeGreaterThan(0)

    const showAll = within(desadv).getByRole('button', { name: 'Show all 34' })

    await userEvent.click(showAll)
    await expect(documentLinks()).toHaveLength(34)
    await expect(showAll).toHaveAccessibleName('Show the latest 5')
    await expect(canvas.getAllByRole('button', { name: 'Ask partner' }).length).toBeGreaterThan(0)
  },
})

export const LargeVolumeGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.largeVolume },
  decorators: [besideSidebar, german],
  async play({ canvas }) {
    await expect(
      await canvas.findAllByText('Neueste 5 von 34, dazu 2 mit Handlungsbedarf'),
    ).toHaveLength(1)
    await expect(canvas.getAllByText('Überfällig').length).toBeGreaterThan(0)
  },
})

export const WaitingForResend = meta.story({
  args: { businessReference: orderLifecycleReferences.waitingForTradingPartner },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'Waiting for Rheinkauf eG to send the purchase order again',
      }),
    ).toBeVisible()
    await expect(
      canvas.getByText(/^Waiting for Rheinkauf eG to send it again since /),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See what to do' })).toBeVisible()
    await expect(canvas.getByText('0 of 3 documents done', { exact: false })).toBeVisible()
  },
})

export const OnTrack = meta.story({
  args: { businessReference: orderLifecycleReferences.onTrack },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 3, name: 'Waiting for the dispatch advice' }),
    ).toBeVisible()
    await expect(canvas.getByText('On track')).toBeVisible()
    await expect(canvas.getAllByText('Not yet')).toHaveLength(2)
  },
})

const ordersAndInvoiceOnly = seedOrderLifecycles()
  .orderLifecycles.filter(
    ({ businessReference }) => businessReference === orderLifecycleReferences.full,
  )
  .map((lifecycle) => ({
    ...lifecycle,
    messages: lifecycle.messages.filter(({ messageType }) => messageType !== 'DESADV'),
  }))

export const MissingDispatchAdvice = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, ordersAndInvoiceOnly))
  },
  async play({ canvasElement }) {
    const desadv = within(
      stepOf(await timelineOf(canvasElement, 'Hansemarkt GmbH'), 'Dispatch advice'),
    )

    await expect(desadv.getByText('Missing')).toBeVisible()
    await expect(desadv.getByText('No dispatch advice found for this order.')).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(
      canvas.getByText(`Loading order ${orderLifecycleReferences.full}`),
    ).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { businessReference: orderLifecycleReferences.full },
  beforeEach({ msw }) {
    msw.use(orderLifecycleHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Order unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { businessReference: orderLifecycleReferences.noMatch },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Order not found' }),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Search for an order' })).toBeVisible()
  },
})

export const German = meta.story({
  args: { businessReference: orderLifecycleReferences.multiPartner },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'Alpenfrisch Märkte AG hat das Lieferavis nicht bestätigt',
      }),
    ).toBeVisible()
    await expect(canvas.getByText('Wartet seit 10 h — Frist 4 h')).toBeVisible()
    await expect(canvas.getAllByText('Empfangsbestätigung').length).toBeGreaterThan(0)
    await expect(canvas.getByRole('button', { name: 'Partner fragen' })).toBeVisible()
  },
})

export const ReceiptConfirmationNotTracked = meta.story({
  args: { businessReference: orderLifecycleReferences.multiPartner },
  async play({ canvasElement }) {
    const desadv = within(
      stepOf(await timelineOf(canvasElement, 'Hansemarkt GmbH'), 'Dispatch advice'),
    )

    await expect(desadv.getByText('Not tracked')).toBeVisible()
    await expect(
      desadv.getByText('Sent before receipt confirmations were tracked.', { exact: false }),
    ).toBeVisible()
    await expect(desadv.queryByText(/Pending|Waiting|no receipt confirmation yet/)).toBeNull()
  },
})

export const ReceiptConfirmationNotTrackedGerman = meta.story({
  args: { businessReference: orderLifecycleReferences.multiPartner },
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'Das Lieferavis wurde an Hansemarkt GmbH gesendet, bevor Empfangsbestätigungen erfasst wurden',
      }),
    ).toBeVisible()

    const desadv = within(
      stepOf(
        await within(canvasElement).findByRole('list', {
          name: 'Belege mit Hansemarkt GmbH, von der Bestellung bis zur Rechnung',
        }),
        'Lieferavis',
      ),
    )

    await expect(desadv.getByText('Nicht erfasst')).toBeVisible()
    await expect(
      desadv.getByText('Gesendet, bevor Empfangsbestätigungen erfasst wurden.', { exact: false }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { businessReference: orderLifecycleReferences.failures },
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        level: 3,
        name: 'The invoice to Elbtal Warenhaus KG could not be processed',
      }),
    ).toBeVisible()
  },
})

export const DarkOverdue = meta.story({
  args: { businessReference: orderLifecycleReferences.multiPartner },
  beforeEach: darkMode,
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Ask partner' }))
    await expect(canvas.getByRole('textbox')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  args: { businessReference: orderLifecycleReferences.failures },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('link', { name: 'See what to do' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
