import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  findAlert,
  findRow,
  openDetails,
  page,
  seeded,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { transformsHiddenKey } from '@/components/mappings/transform-list'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { createHandlers } from '@edi-bridge/mocks'

import type { RowRef } from '@/components/mappings/mapping-links'

import preview from '../../.storybook/preview'

const inbound = seeded('Hansemarkt: ORDERS to ERP JSON')

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const deepTarget: RowRef = { side: 'target', path: 'lines[].gtin' }

const repeatedSource: RowRef = { side: 'source', path: 'packages[].lines[].gtin' }

function partOf(row: HTMLElement) {
  return row.closest<HTMLElement>('[data-failing]')
}

function rectOf(canvasElement: HTMLElement, selector: string) {
  return canvasElement.querySelector(selector)!.getBoundingClientRect()
}

const viewports = {
  viewport: {
    options: {
      laptop: { name: 'Laptop', styles: { width: '1024px', height: '900px' } },
      desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
      tall: { name: 'Tall desktop', styles: { width: '1440px', height: '1800px' } },
    },
  },
}

function on(viewport: keyof typeof viewports.viewport.options) {
  return { parameters: viewports, globals: { viewport: { value: viewport, isRotated: false } } }
}

function zoomOf(canvasElement: HTMLElement) {
  const { transform } = canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!.style

  return Number(/scale\(([\d.]+)\)/.exec(transform)?.[1])
}

function sourceTreeOf(canvasElement: HTMLElement) {
  const boxes = [...canvasElement.querySelectorAll('.react-flow__node[data-id^="source:"]')].map(
    (node) => node.getBoundingClientRect(),
  )

  return {
    top: Math.min(...boxes.map(({ top }) => top)),
    bottom: Math.max(...boxes.map(({ bottom }) => bottom)),
  }
}

// At no less than the zoom floor, with the details closed, the field's whole row is in the pane
// beside the source column: all of it, or at least its right edge with the link handles. While the
// source tree fits the pane's height, its first fields stay in view.
async function expectFieldBesideSources(
  canvasElement: HTMLElement,
  field: HTMLElement,
  source: 'whole' | 'edge' = 'whole',
) {
  const pane = rectOf(canvasElement, '.mapping-canvas')
  const box = field.closest('.react-flow__node')!.getBoundingClientRect()
  const heading = rectOf(canvasElement, '.react-flow__node[data-id="source:heading"]')
  const tree = sourceTreeOf(canvasElement)

  await expect(page(canvasElement).queryByRole('dialog', { name: 'Details' })).toBeNull()
  await expect(zoomOf(canvasElement)).toBeGreaterThanOrEqual(0.82)
  await expect(box.left).toBeGreaterThanOrEqual(pane.left)
  await expect(box.right).toBeLessThanOrEqual(pane.right)
  await expect(box.top).toBeGreaterThanOrEqual(pane.top)
  await expect(box.bottom).toBeLessThanOrEqual(pane.bottom)
  await expect(heading.right).toBeGreaterThan(pane.left)
  await expect(heading.right).toBeLessThanOrEqual(pane.right)

  if (source === 'whole') {
    await expect(heading.left).toBeGreaterThanOrEqual(pane.left)
  }

  if (tree.bottom - tree.top <= pane.height - 48) {
    await expect(tree.top).toBeGreaterThanOrEqual(pane.top)
  }
}

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/FailingField',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: inbound.id, field: deepTarget.path },
  decorators: [
    (Story) => (
      <div className="flex h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const TargetField = meta.story({
  async play({ canvas, canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await expect(alert.getByText(/The field is in the target: Document Structure/)).toBeVisible()
    await expect(alert.getByText(/It is marked on the canvas\./)).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Show the field' })).toBeVisible()
    await expect(alert.getByRole('link', { name: 'Back to documents' })).toHaveAttribute(
      'href',
      '/documents',
    )

    const row = await findRow(canvasElement, deepTarget)

    await expect(partOf(row)).toHaveAttribute('data-failing', 'field')
    await expect(within(row).getByText('Failed here')).toBeVisible()
    await expect(canvas.getAllByText('Failed here')).toHaveLength(1)

    // Arriving does not move the view: it opens at the top, as for any Mapping.
    await expect(row).not.toHaveFocus()
    await expect(
      canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform,
    ).toMatch(/translate\([\d.]+px, 24px\)/)
  },
})

export const ShowTheField = meta.story({
  ...on('desktop'),
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, deepTarget)

    await waitFor(() => expect(row).toHaveFocus())
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expectFieldBesideSources(canvasElement, row))
  },
})

// The details close to make room for the field beside the source column.
export const ShowTheFieldClosesDetails = meta.story({
  ...on('desktop'),
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await findRow(canvasElement, deepTarget)
    await openDetails(canvasElement)
    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, deepTarget)

    await waitFor(() => expect(row).toHaveFocus())
    await waitFor(() => expectFieldBesideSources(canvasElement, row))
  },
})

// On a laptop the Transforms also fold to their rail for this visit, without keeping that choice;
// the target field then keeps the source column's right edge beside it.
export const ShowTheFieldOnLaptop = meta.story({
  ...on('laptop'),
  beforeEach() {
    window.localStorage.removeItem(transformsHiddenKey)
  },
  async play({ canvas, canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await findRow(canvasElement, deepTarget)
    await expect(canvas.getByRole('button', { name: 'Hide the Transforms' })).toBeVisible()
    await openDetails(canvasElement)
    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, deepTarget)

    await waitFor(() => expect(row).toHaveFocus())
    await waitFor(() => expectFieldBesideSources(canvasElement, row, 'edge'))
    await expect(canvas.getByRole('button', { name: 'Show the Transforms' })).toBeVisible()
    await expect(window.localStorage.getItem(transformsHiddenKey)).not.toBe('true')
  },
})

// Centring the last source field would push the first ones off the top; the whole tree fits, so
// it stays in view from its first field.
export const ShowTheFieldKeepsFirstSourceFields = meta.story({
  ...on('tall'),
  args: { id: outbound.id, field: 'packages[].lines[].quantity' },
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at packages › lines › quantity')

    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, {
      side: 'source',
      path: 'packages[].lines[].quantity',
    })

    const pane = rectOf(canvasElement, '.mapping-canvas')

    await waitFor(() => expect(row).toHaveFocus())
    await waitFor(() => expectFieldBesideSources(canvasElement, row))

    const tree = sourceTreeOf(canvasElement)

    await expect(tree.bottom - tree.top).toBeLessThanOrEqual(pane.height - 48)
    await expect(tree.top).toBeGreaterThanOrEqual(pane.top)
  },
})

export const SourceFieldInRepetition = meta.story({
  ...on('desktop'),
  args: { id: outbound.id, field: repeatedSource.path },
  async play({ canvas, canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at packages › lines › gtin')

    await expect(alert.getByText(/The field is in the source: Document Structure/)).toBeVisible()

    // Collapsed, the part holding the field carries the mark instead.
    await userEvent.click(await canvas.findByRole('button', { name: 'Collapse packages' }))

    const part = await findRow(canvasElement, { side: 'source', path: 'packages[]' })

    await expect(partOf(part)).toHaveAttribute('data-failing', 'inside')
    await expect(within(part).getByText('Failed inside')).toBeVisible()

    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, repeatedSource)

    await waitFor(() => expect(row).toHaveFocus())
    await expect(partOf(row)).toHaveAttribute('data-failing', 'field')
    await expect(canvas.getByRole('button', { name: 'Collapse packages' })).toBeVisible()
    await waitFor(() => expectFieldBesideSources(canvasElement, row))
  },
})

export const NumberedRepetition = meta.story({
  args: { id: outbound.id, field: 'packages[2].lines[0].gtin' },
  async play({ canvasElement }) {
    await findAlert(canvasElement, 'A document failed at packages › lines › gtin')
    await expect(partOf(await findRow(canvasElement, repeatedSource))).toHaveAttribute(
      'data-failing',
      'field',
    )
  },
})

export const UnknownField = meta.story({
  args: { id: inbound.id, field: 'invoice.nowhere' },
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'Field not found in this Mapping')

    await expect(alert.getByText('invoice.nowhere')).toBeVisible()
    await expect(alert.queryByRole('button', { name: 'Show the field' })).toBeNull()
    await expect(alert.getByRole('link', { name: 'Back to documents' })).toBeVisible()
    await findRow(canvasElement, deepTarget)
    await expect(canvasElement.querySelector('[data-failing]')).toBeNull()
  },
})

export const SmallScreen = meta.story({
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await expect(alert.getByText(/The field is in the target/)).toBeVisible()
    await expect(alert.queryByText(/1024 pixels|marked on the canvas/)).toBeNull()
    await expect(alert.queryByRole('button', { name: 'Show the field' })).toBeNull()
    await expect(within(canvasElement).getByText(/at least 1024 pixels wide/)).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow')).toBeNull()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvasElement }) {
      const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

      await expect(alert.queryByText(/publish the Draft/)).toBeNull()
      await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))
      await waitFor(async () => expect(await findRow(canvasElement, deepTarget)).toHaveFocus())
    },
  }),
})

export const German = meta.story({
  args: { id: inbound.id, field: 'buyer.gln' },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'Ein Beleg ist an buyer › gln gescheitert')

    await expect(alert.getByText(/Das Feld liegt im Ziel/)).toBeVisible()
    await expect(alert.getByRole('link', { name: 'Zurück zu den Belegen' })).toBeVisible()
    await userEvent.click(alert.getByRole('button', { name: 'Feld zeigen' }))

    const row = await findRow(canvasElement, { side: 'target', path: 'buyer.gln' })

    await waitFor(() => expect(row).toHaveFocus())
    await expect(within(row).getByText('Fehler hier')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: outbound.id, field: repeatedSource.path },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at packages › lines › gtin')

    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))
    await waitFor(async () => expect(await findRow(canvasElement, repeatedSource)).toHaveFocus())
  },
})
