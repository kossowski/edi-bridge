import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  findRow,
  openDetails,
  page,
  seeded,
} from '@/components/mappings/mapping-canvas-story-helpers'
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

async function findAlert(canvasElement: HTMLElement, title: string) {
  const alert = await waitFor(
    () => {
      const found = within(canvasElement)
        .getAllByRole('alert')
        .find((element) => element.textContent.includes(title))

      if (!found) {
        throw new Error(`No alert with ${title}`)
      }

      return found
    },
    { timeout: 5000 },
  )

  return within(alert)
}

// The field and the whole source tree are inside the part of the pane that nothing covers.
async function expectFieldBesideSources(canvasElement: HTMLElement, field: HTMLElement) {
  const pane = rectOf(canvasElement, '.mapping-canvas')
  const details = page(canvasElement).queryByRole('dialog', { name: 'Details' })
  const right = details ? details.getBoundingClientRect().left : pane.right
  const box = field.getBoundingClientRect()
  const sources = rectOf(canvasElement, '.react-flow__node[data-id="source:heading"]')

  await expect(box.left).toBeGreaterThanOrEqual(pane.left)
  await expect(box.right).toBeLessThanOrEqual(right)
  await expect(box.top).toBeGreaterThanOrEqual(pane.top)
  await expect(box.bottom).toBeLessThanOrEqual(pane.bottom)
  await expect(sources.left).toBeGreaterThanOrEqual(pane.left)
  await expect(sources.right).toBeLessThanOrEqual(right)
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
  },
})

export const ShowTheField = meta.story({
  async play({ canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at lines › gtin')

    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, deepTarget)

    await waitFor(() => expect(row).toHaveFocus())
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expectFieldBesideSources(canvasElement, row))
  },
})

// The open details cover the right of the pane; the field and the source fields stay left of them.
export const ShowTheFieldBesideDetails = meta.story({
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

export const SourceFieldInRepetition = meta.story({
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

    await expect(alert.getByText(/at least 1024 pixels wide/)).toBeVisible()
    await expect(alert.queryByRole('button', { name: 'Show the field' })).toBeNull()
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
