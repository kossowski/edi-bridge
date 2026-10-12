import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  openEmptyEditor,
  detailsPanel,
  dragLink,
  openDetails,
  dragOver,
  drop,
  findRow,
  findSaveStatus,
  handleOf,
  liveStatus,
  page,
  pressOn,
  seeded,
  source,
  startDrag,
  target,
  expectSavedLinkCount,
  findLinkMenu,
  openLinkMenuByKeyboard,
  openLinkMenuByMouse,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { nodeId } from '@/components/mappings/mapping-tree'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  documentStructureEndpoint,
  mappingDraftEndpoint,
  saveMappingDraftEndpoint,
} from '@edi-bridge/contracts'
import { createDocumentStructure, createHandlers, createMappingDrafts } from '@edi-bridge/mocks'

import type { RowRef } from '@/components/mappings/mapping-links'

import preview from '../../.storybook/preview'

const inbound = seeded('Hansemarkt: ORDERS to ERP JSON')

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const largeStructure = createDocumentStructure({ fieldCount: 400 })

const [, , largeDraft] = createMappingDrafts({ count: 3, documentStructures: [largeStructure] })

async function findTooltip(canvasElement: HTMLElement) {
  const tooltip = await page(canvasElement).findByRole('tooltip')

  await waitFor(() => expect(tooltip).toBeVisible())

  return within(tooltip)
}

function edgeOf(canvasElement: HTMLElement, from: RowRef, to: RowRef) {
  return canvasElement.querySelector<SVGElement>(
    `.react-flow__edge[data-id="${CSS.escape(`${nodeId(from.side, from.path)}->${nodeId(to.side, to.path)}`)}"] .react-flow__edge-interaction`,
  )
}

function inside(box: DOMRect, pane: DOMRect) {
  return (
    box.left >= pane.left &&
    box.right <= pane.right &&
    box.top >= pane.top &&
    box.bottom <= pane.bottom
  )
}

function screenPoint(path: SVGGeometryElement, length: number) {
  return new DOMPoint(
    path.getPointAtLength(length).x,
    path.getPointAtLength(length).y,
  ).matrixTransform(path.getScreenCTM()!)
}

function links(canvasElement: HTMLElement) {
  return [...canvasElement.querySelectorAll<SVGGElement>('.react-flow__edge')]
}

function linkTabStops(canvasElement: HTMLElement) {
  return links(canvasElement).filter((link) => link.tabIndex === 0)
}

// The ring around a focused link is in the text colour, which stands out from the canvas.
async function expectFocusRing(link: SVGGElement) {
  const ring = getComputedStyle(link.querySelector('.link-focus-ring')!)

  await expect(link).toHaveFocus()
  await expect(link).toHaveAttribute('tabindex', '0')
  await expect(ring.stroke).toBe(getComputedStyle(link.ownerDocument.body).color)
  await expect(ring.strokeWidth).toBe('10px')
}

// A link is a single Tab stop: the arrow keys move between the links, Tab on to the trees.
async function moveToNextLink(canvasElement: HTMLElement) {
  await waitFor(() => expect(linkTabStops(canvasElement)).toHaveLength(1))

  const [first] = linkTabStops(canvasElement)
  const next = links(canvasElement)[links(canvasElement).indexOf(first!) + 1]!

  first!.focus()
  await userEvent.keyboard('{ArrowDown}')
  await waitFor(() => expect(linkTabStops(canvasElement)).toEqual([next]))

  return next
}

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Outbound = meta.story({
  args: { id: outbound.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ERP JSON to DESADV' }),
    ).toBeVisible()
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()
    await expect(canvas.getByText('UNH')).toBeVisible()
    await expect(
      await canvas.findByRole('group', { name: 'Link from despatchNumber to BGM/1004' }),
    ).toBeInTheDocument()

    const details = await openDetails(canvasElement)

    await expect(details.getByText('Outbound: data format to Message Type')).toBeVisible()
    await expect(details.getByText('32 links')).toBeVisible()
    await expect(details.getByRole('button', { name: 'Close details' })).toBeVisible()
  },
})

export const Inbound = meta.story({
  args: { id: inbound.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
    await expect(await canvas.findByText('orderNumber')).toBeVisible()
    await expect(
      await canvas.findByRole('group', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()

    const details = await openDetails(canvasElement)

    await expect(details.getByText('Inbound: Message Type to data format')).toBeVisible()
  },
})

export const CollapseParts = meta.story({
  args: { id: inbound.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Collapse UNH' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse BGM' }))
    await expect(canvas.getByRole('button', { name: 'Expand BGM' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(await canvas.findByText('DTM+137')).toBeVisible()
    await expect(
      await canvas.findByRole('group', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()
  },
})

const desktopViewports = {
  viewport: {
    options: {
      laptop: { name: 'Laptop', styles: { width: '1024px', height: '900px' } },
      desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
      wide: { name: 'Wide desktop', styles: { width: '1600px', height: '900px' } },
    },
  },
  a11y: { config: { rules: [{ id: 'target-size', enabled: true }] } },
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

async function expectClearTargets(canvasElement: HTMLElement, zoom?: string) {
  const viewport = canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!

  await waitFor(() =>
    expect(viewport.style.transform).toContain(zoom === undefined ? 'scale(' : `scale(${zoom})`),
  )

  for (const toggle of canvasElement.querySelectorAll('.react-flow__node button')) {
    const { width, height } = toggle.getBoundingClientRect()

    await expect(Math.min(width, height)).toBeGreaterThanOrEqual(24)
  }

  const pane = canvasElement.querySelector('.react-flow')!.getBoundingClientRect()

  const panels = ['.react-flow__controls', '.react-flow__attribution'].map((selector) =>
    canvasElement.querySelector(selector)!.getBoundingClientRect(),
  )

  const parts = [...canvasElement.querySelectorAll('.react-flow__node')].map((node) =>
    node.getBoundingClientRect(),
  )

  for (const panel of panels) {
    await expect(
      parts.filter((part) => overlaps(part, pane) && overlaps(part, panel)),
    ).toHaveLength(0)
  }

  await expect(
    canvasElement.querySelector('.react-flow__attribution a')!.getBoundingClientRect().height,
  ).toBeGreaterThanOrEqual(24)
}

export const Desktop = meta.story({
  args: { id: inbound.id },
  parameters: desktopViewports,
  globals: { viewport: { value: 'desktop', isRotated: false } },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('button', { name: 'Collapse DTM+137' })
    await expectClearTargets(canvasElement)

    // The first view fits both trees into the pane beside the Transforms.
    const pane = canvasElement.querySelector('.react-flow')!.getBoundingClientRect()

    const targetHeading = canvasElement
      .querySelector('.react-flow__node[data-id="target:heading"]')!
      .getBoundingClientRect()

    await expect(targetHeading.right).toBeLessThanOrEqual(pane.right)
  },
})

export const MinimumZoom = meta.story({
  args: { id: inbound.id },
  parameters: desktopViewports,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  decorators: [
    // Stands in for the app sidebar, which narrows the canvas until it opens at the minimum zoom.
    (Story) => (
      <div className="flex flex-1">
        <div className="w-64 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Story />
        </div>
      </div>
    ),
  ],
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('button', { name: 'Collapse DTM+137' })
    await expectClearTargets(canvasElement, '0.82')
  },
})

export const EmptyDraft = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    await expect(await canvas.findByText('invoiceNumber')).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow__edge')).toBeNull()
    await expect((await openDetails(canvasElement)).getByText('No links yet')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: largeDraft!.id },
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: [largeDraft!],
        documentStructures: [largeStructure],
      }),
    )
  },
  // Contrast is checked on the same nodes in the small stories; see the Mappings list.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(largeStructure.name, { exact: false })).toBeVisible()

    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__node-tree').length).toBeGreaterThan(0),
    )

    // Every part is rendered, also those out of view, so that each one can get keyboard focus.
    const nodes = canvasElement.querySelectorAll('.react-flow__node-tree')

    await expect(nodes.length).toBeGreaterThan(400)
    await expect(canvasElement.querySelectorAll('.react-flow__node-transform')).toHaveLength(30)

    const rows = [
      ...canvasElement.querySelectorAll<HTMLElement>('.react-flow__node-tree button[aria-pressed]'),
    ]

    await expect(rows.length).toBe(nodes.length)
    await expect(rows.every((row) => row.tabIndex === 0)).toBe(true)

    // A pending link marks every free target leaf and transform input, which must stay checkable
    // at this volume. Every target is taken here, so a new transform brings free inputs.
    await userEvent.click(canvas.getByRole('button', { name: 'Add Concatenate' }))
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toHaveTextContent(/^Concatenate \d+$/),
    )

    const from = canvasElement.querySelector<HTMLElement>(
      '.react-flow__node[data-id^="source:"]:has(.link-handle) button[aria-pressed]',
    )!

    await pressOn(from, 'l')
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('[data-link-target]').length).toBeGreaterThan(0),
    )
  },
})

export const KeyboardPansToParts = meta.story({
  args: { id: inbound.id },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('button', { name: 'Collapse UNH' })

    const flow = canvasElement.querySelector('.react-flow')!
    const viewport = canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!

    await waitFor(() => expect(viewport.style.transform).not.toContain('translate(0px, 0px)'))
    const toggles = canvas.getAllByRole('button', { name: /^Collapse / })

    const hidden = toggles.findIndex(
      (toggle) => toggle.getBoundingClientRect().top > flow.getBoundingClientRect().bottom,
    )

    await expect(hidden).toBeGreaterThan(0)

    const focusable = [...canvasElement.querySelectorAll<HTMLElement>('.react-flow__node button')]

    focusable[focusable.indexOf(toggles[hidden]!) - 1]!.focus()

    const before = viewport.style.transform

    await userEvent.tab()

    const focused = toggles[hidden]!

    await expect(focused).toHaveFocus()
    await waitFor(() => expect(viewport.style.transform).not.toBe(before))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const box = focused.getBoundingClientRect()
    const pane = flow.getBoundingClientRect()

    await expect(flow.scrollTop).toBe(0)
    await expect(box.top).toBeGreaterThanOrEqual(pane.top)
    await expect(box.bottom).toBeLessThanOrEqual(pane.bottom)
  },
})

export const EmptyPart = meta.story({
  args: { id: outbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, () =>
        HttpResponse.json({
          ...createDocumentStructure({ fieldCount: 1 }),
          children: [
            {
              kind: 'object',
              path: 'header',
              name: 'header',
              label: 'Header',
              labelReason: '"header" is a common name for "Header".',
              labelUnsure: false,
              required: true,
              children: [],
            },
          ],
        }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('header')).toBeVisible()
    await expect(canvas.getByText('Empty')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /(Expand|Collapse) header/ })).toBeNull()
    await expect(canvas.getByText('UNH')).toBeVisible()
    // Only the transforms' own links into the target are left, as no source field exists.
    await expect(canvasElement.querySelector('.react-flow__edge[data-id^="source:"]')).toBeNull()
  },
})

export const Loading = meta.story({
  args: { id: inbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingDraftEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Mapping')).toBeInTheDocument()
  },
})

export const LoadingStructures = meta.story({
  args: { id: outbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the structures')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: inbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingDraftEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping unavailable')).toBeVisible()
  },
})

export const StructuresUnavailable = meta.story({
  args: { id: outbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Structures unavailable')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping not found')).toBeVisible()
  },
})

export const SmallScreen = meta.story({
  args: { id: inbound.id },
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow')).toBeNull()
  },
})

export const German = meta.story({
  args: { id: inbound.id },
  parameters: desktopViewports,
  globals: { viewport: { value: 'desktop', isRotated: false } },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('Nachrichtenkopf')).toBeVisible()
    await expect(
      await canvas.findByRole('group', { name: 'Verknüpfung von BGM/1004 zu orderNumber' }),
    ).toBeInTheDocument()

    const row = await findRow(canvasElement, { side: 'source', path: 'DTM+137' })
    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('Eingehend: Message Type zu Datenformat')).toBeVisible()
    await userEvent.click(row)
    await expect(panel.getByText('Quelle')).toBeVisible()
    await expect(panel.getByText('Dokumenten-/Nachrichtendatum/-zeit')).toBeVisible()
    await expect(panel.getByText('Muss')).toBeVisible()
    await expect(panel.getByText('Einmal')).toBeVisible()

    for (const value of page(canvasElement)
      .getByRole('dialog', { name: 'Details' })
      .querySelectorAll('dd')) {
      await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth)
    }

    await userEvent.hover(row)
    await expect((await findTooltip(canvasElement)).getByText('Einmal')).toBeVisible()

    await pressOn(await findRow(canvasElement, source('DTM+137/C507/2380')), 'l')
    await expect(
      panel.getByText('Verknüpfung von DTM+137/C507/2380 begonnen.', { exact: false }),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Verknüpfen abbrechen' })).toBeVisible()
    await pressOn(await findRow(canvasElement, target('orderDate')), 'l')
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'orderDate ist bereits mit DTM+137/C507/2380 verknüpft. Entfernen Sie zuerst diese Verknüpfung.',
      ),
    )

    const menu = await openLinkMenuByKeyboard(
      canvasElement,
      'Verknüpfung von BGM/1004 zu orderNumber',
    )

    await expect(menu.getByText('BGM/1004 → orderNumber')).toBeVisible()
    await expect(
      menu.getByRole('menuitem', { name: 'BGM/1004 in der Quelle anzeigen' }),
    ).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Verknüpfung entfernen' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())

    // Open, the details cover part of the canvas; closed, every part is in reach again.
    await userEvent.click(panel.getByRole('button', { name: 'Details schließen' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
  },
})

export const Dark = meta.story({
  args: { id: outbound.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()

    const row = await findRow(canvasElement, { side: 'target', path: 'DTM+137' })
    const details = await openDetails(canvasElement)

    await userEvent.click(row)
    await expect(details.getByText('Document/message date/time')).toBeVisible()
    await userEvent.hover(row)
    await findTooltip(canvasElement)

    // The marks of a pending link and a link's menu, checked in dark too.
    await pressOn(await findRow(canvasElement, source('despatchDate')), 'l')

    const menu = await openLinkMenuByMouse(canvasElement, 'Link from despatchNumber to BGM/1004')

    await expect(menu.getByRole('menuitem', { name: 'Remove link' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())
    await expectFocusRing(await moveToNextLink(canvasElement))
  },
})

export const HoverMeaning = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.hover(await findRow(canvasElement, { side: 'source', path: 'DTM+137' }))

    const tooltip = await findTooltip(canvasElement)

    await expect(tooltip.getByText('DTM+137')).toBeVisible()
    await expect(tooltip.getByText('Document/message date/time')).toBeVisible()
    await expect(tooltip.getByText('Mandatory')).toBeVisible()
    await expect(tooltip.getByText('Once')).toBeVisible()
  },
})

export const HoverMeaningOnTarget = meta.story({
  args: { id: outbound.id },
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, { side: 'target', path: 'DTM+137' })

    await userEvent.hover(row)

    const tooltip = await findTooltip(canvasElement)

    await expect(tooltip.getByText('Document/message date/time')).toBeVisible()
    await expect(row).toHaveAccessibleDescription(/Document\/message date\/time/)
  },
})

export const KeyboardFocusMeaning = meta.story({
  args: { id: inbound.id },
  async play({ canvas, canvasElement }) {
    const row = await findRow(canvasElement, { side: 'source', path: 'DTM+137' })
    const details = await openDetails(canvasElement)

    canvas.getByRole('button', { name: 'Collapse DTM+137' }).focus()
    await userEvent.tab()
    await expect(row).toHaveFocus()
    await expect(
      (await findTooltip(canvasElement)).getByText('Document/message date/time'),
    ).toBeVisible()

    await userEvent.keyboard('{Enter}')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await expect(details.getByText('Document/message date/time')).toBeVisible()

    await userEvent.tab({ shift: true })
    await userEvent.tab()
    await findTooltip(canvasElement)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('tooltip')).toBeNull())
    await expect(row).toHaveFocus()
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    await userEvent.keyboard('{Escape}')
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await expect(details.getByText(/^Select a part/)).toBeVisible()

    await userEvent.keyboard(' ')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
  },
})

export const SelectedRow = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, { side: 'source', path: 'DTM+137' })

    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()

    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('Document/message date/time')).toBeVisible()
    await expect(panel.getByText('Source')).toBeVisible()

    await userEvent.click(panel.getByRole('button', { name: 'Clear selection' }))
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(row).toHaveFocus())

    await userEvent.click(row)
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(await findRow(canvasElement, { side: 'target', path: 'orderNumber' }))

    const reopened = await detailsPanel(canvasElement)

    await expect(reopened.getByText('Target')).toBeVisible()
    await expect(reopened.getByText('Required')).toBeVisible()
  },
})

export const QualifiedGroup = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.hover(await findRow(canvasElement, { side: 'source', path: 'SG2+BY' }))

    const tooltip = await findTooltip(canvasElement)

    await expect(tooltip.getByText('Name and address')).toBeVisible()
    await expect(tooltip.getByText('Buyer')).toBeVisible()

    await userEvent.click(await findRow(canvasElement, { side: 'source', path: 'SG2+BY/NAD+BY' }))

    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('NAD+BY')).toBeVisible()
    await expect(panel.getByText('Buyer')).toBeVisible()
  },
})

export const CodedElement = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.click(
      await findRow(canvasElement, { side: 'source', path: 'DTM+137/C507/2379' }),
    )

    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('Date/time/period format qualifier')).toBeVisible()
    await expect(
      panel.getByText('(alphanumeric, up to 3 characters)', { exact: false }),
    ).toBeVisible()
    await expect(panel.getByText('CCYYMMDD')).toBeVisible()
    await expect(panel.getByText('CCYYMMDDHHMM')).toBeVisible()
  },
})

const linkStories = {
  a11y: { config: { rules: [{ id: 'target-size', enabled: true }] } },
}

export const DrawLinkByMouse = meta.story({
  args: { id: withoutLinks.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    await userEvent.click(await canvas.findByRole('button', { name: 'Collapse UNH' }))
    await findRow(canvasElement, target('BGM/1004'))

    await dragLink(canvasElement, source('invoiceNumber'), target('BGM/1004'))

    await expect(
      await canvas.findByRole('group', { name: 'Link from invoiceNumber to BGM/1004' }),
    ).toBeInTheDocument()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expectSavedLinkCount(withoutLinks.id, 1)
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'Link from invoiceNumber to BGM/1004 added.',
      ),
    )
  },
})

export const DrawLinkByKeyboard = meta.story({
  args: { id: withoutLinks.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    const from = await findRow(canvasElement, source('invoiceNumber'))
    const to = await findRow(canvasElement, target('BGM/1004'))

    await pressOn(from, '{Enter}')

    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('Shortcut: press L', { exact: false })).toBeVisible()
    await pressOn(panel.getByRole('button', { name: 'Link from here' }), '{Enter}')

    await expect(panel.getByText('Linking from invoiceNumber.', { exact: false })).toBeVisible()
    await waitFor(() => expect(from).toHaveFocus())
    await expect(liveStatus(canvasElement)).toHaveTextContent('Linking from invoiceNumber.')
    await expect(to).toHaveAccessibleDescription('Can take the link from invoiceNumber')
    await expect(to.closest('[data-link-target]')).not.toBeNull()

    await pressOn(to, '{Enter}')
    await pressOn(panel.getByRole('button', { name: 'Link to here' }), '{Enter}')

    await expect(
      await canvas.findByRole('group', { name: 'Link from invoiceNumber to BGM/1004' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(to).toHaveFocus())
    await expect(panel.getByText('invoiceNumber to BGM/1004')).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    // The shortcut: L on a source starts a link, L on a target finishes it.
    await pressOn(await findRow(canvasElement, source('invoiceDate')), 'l')
    await pressOn(await findRow(canvasElement, target('DTM+137/C507/2380')), 'l')
    await expect(
      await canvas.findByRole('group', { name: 'Link from invoiceDate to DTM+137/C507/2380' }),
    ).toBeInTheDocument()
    await expectSavedLinkCount(withoutLinks.id, 2)

    // Escape cancels a pending link first and clears the selection only after that.
    const pending = await findRow(canvasElement, source('deliveryDate'))

    await pressOn(pending, 'l')
    await expect(pending).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(panel.queryByText('Linking from', { exact: false })).toBeNull()
    await expect(liveStatus(canvasElement)).toHaveTextContent('Link from deliveryDate cancelled.')
    await expect(pending).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Escape}')
    await expect(pending).toHaveAttribute('aria-pressed', 'false')
  },
})

export const RemoveLinkByMouse = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    const menu = await openLinkMenuByMouse(canvasElement, 'Link from despatchNumber to BGM/1004')

    await userEvent.click(menu.getByRole('menuitem', { name: 'Remove link' }))

    await waitFor(() =>
      expect(
        canvas.queryByRole('group', { name: 'Link from despatchNumber to BGM/1004' }),
      ).toBeNull(),
    )
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())
    await expectSavedLinkCount(outbound.id, 31)
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    // A link into collapsed parts stands for several; its menu lists them by name first.
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse packages' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse SG10' }))

    const merged = await openLinkMenuByMouse(canvasElement, '9 links from packages[] to SG10')

    await expect(merged.queryByRole('menuitem', { name: 'Remove link' })).toBeNull()
    await userEvent.click(merged.getByRole('menuitem', { name: 'Show the 9 links' }))

    const panel = await detailsPanel(canvasElement)

    // The panel also lists the loop that takes the whole part.
    await expect(panel.getAllByRole('button', { name: /^Remove link from packages/ })).toHaveLength(
      11,
    )
    // Focus moves a frame after the panel lists the links.
    await waitFor(() =>
      expect(
        panel.getByRole('button', {
          name: 'Remove link from packages[].packageNumber to SG10/CPS/7164',
        }),
      ).toHaveFocus(),
    )
    await expectSavedLinkCount(outbound.id, 31)
  },
})

export const RemoveLinkByKeyboard = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    const row = await findRow(canvasElement, source('despatchNumber'))

    await pressOn(row, '{Enter}')

    const panel = await openDetails(canvasElement)

    await pressOn(
      panel.getByRole('button', { name: 'Remove link from despatchNumber to BGM/1004' }),
      '{Enter}',
    )

    await waitFor(() =>
      expect(
        canvas.queryByRole('group', { name: 'Link from despatchNumber to BGM/1004' }),
      ).toBeNull(),
    )
    await waitFor(() => expect(row).toHaveFocus())
    await expect(panel.getByText('This part has no links yet.')).toBeVisible()
    await expectSavedLinkCount(outbound.id, 31)

    // Delete removes the only link of the focused part.
    await pressOn(await findRow(canvasElement, source('documentDate')), '{Delete}')
    await waitFor(() =>
      expect(
        canvas.queryByRole('group', { name: 'Link from documentDate to DTM+137/C507/2380' }),
      ).toBeNull(),
    )
    await expectSavedLinkCount(outbound.id, 30)

    // A part holding several links keeps them and says how to remove them.
    await pressOn(await findRow(canvasElement, source('packages[]')), '{Delete}')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        'packages has 11 links. Select it to remove them one by one.',
      ),
    )
    await expectSavedLinkCount(outbound.id, 30)

    // The menu key on a focused link opens its menu; the focus goes to where the link started.
    await openLinkMenuByKeyboard(
      canvasElement,
      'Link from despatchDate to DTM+11/C507/2380',
      '{ContextMenu}',
    )
    await userEvent.keyboard('{ArrowUp}{Enter}')
    await waitFor(() =>
      expect(
        canvas.queryByRole('group', { name: 'Link from despatchDate to DTM+11/C507/2380' }),
      ).toBeNull(),
    )
    await waitFor(async () =>
      expect(await findRow(canvasElement, source('despatchDate'))).toHaveFocus(),
    )
    await expectSavedLinkCount(outbound.id, 29)
  },
})

export const LinkMenuOfLongEdge = meta.story({
  args: { id: inbound.id },
  parameters: linkStories,
  // A short canvas, so the long edge runs out of view.
  decorators: [
    (Story) => (
      <div className="flex h-[26rem] flex-col">
        <Story />
      </div>
    ),
  ],
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Collapse buyer' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse SG2+BY' }))

    const pane = canvasElement.querySelector('.react-flow')!.getBoundingClientRect()

    const edge = await waitFor(() => {
      const found = edgeOf(canvasElement, source('SG2+BY'), target('buyer'))

      if (!(found instanceof SVGGeometryElement)) {
        throw new Error('No edge from SG2+BY to buyer')
      }

      return found
    })

    await new Promise((resolve) => requestAnimationFrame(resolve))

    const middle = screenPoint(edge, edge.getTotalLength() / 2)

    await expect(inside(new DOMRect(middle.x, middle.y), pane)).toBe(false)

    // From the keyboard, the menu opens at the part of the link in view.
    const menu = await openLinkMenuByKeyboard(canvasElement, '8 links from SG2+BY to buyer')

    await expect(menu.getByRole('menuitem', { name: 'Show the 8 links' })).toBeVisible()

    const box = page(canvasElement).getByRole('menu').getBoundingClientRect()
    const view = new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const near = (a: number, b: number) => Math.abs(a - b) <= 8

    const shown = Array.from({ length: 101 }, (_, step) =>
      screenPoint(edge, (edge.getTotalLength() * step) / 100),
    ).filter((point) => inside(new DOMRect(point.x, point.y), pane))

    await expect(inside(box, view)).toBe(true)
    // A corner of the menu sits on the link where the link shows.
    await expect(
      shown.some(
        (point) =>
          (near(point.y, box.top) || near(point.y, box.bottom)) &&
          point.x >= box.left - 8 &&
          point.x <= box.right + 8,
      ),
    ).toBe(true)

    // Escape closes it and takes the focus back to the link, with nothing removed.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())
    await waitFor(() =>
      expect(canvas.getByRole('group', { name: '8 links from SG2+BY to buyer' })).toHaveFocus(),
    )
    await expect(canvas.queryByText('Saving…')).toBeNull()
  },
})

export const LinkFocusByKeyboard = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('group', { name: 'Link from despatchNumber to BGM/1004' })

    const link = await moveToNextLink(canvasElement)

    await expectFocusRing(link)

    await userEvent.tab()
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement?.closest('.react-flow__edge')).toBeNull(),
    )
    await expect(
      canvasElement.ownerDocument.activeElement?.closest('.react-flow__node'),
    ).not.toBeNull()

    await userEvent.tab({ shift: true })
    await waitFor(() => expect(link).toHaveFocus())

    await userEvent.keyboard(' ')

    const menu = await findLinkMenu(canvasElement)

    await expect(menu.getAllByRole('menuitem').length).toBeGreaterThan(0)
  },
})

export const LinkMenuByMouse = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvasElement }) {
    const menu = await openLinkMenuByMouse(canvasElement, 'Link from despatchNumber to BGM/1004')

    await expect(menu.getByText('despatchNumber → BGM/1004')).toBeVisible()
    await expect(
      menu.getByRole('menuitem', { name: 'Show despatchNumber in the source' }),
    ).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Show BGM/1004 in the target' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Remove link' })).toBeVisible()
  },
})

export const LinkMenuByKeyboard = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvasElement }) {
    const menu = await openLinkMenuByKeyboard(canvasElement, 'Link from despatchNumber to BGM/1004')

    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(
        menu.getByRole('menuitem', { name: 'Show despatchNumber in the source' }),
      ).toHaveFocus(),
    )

    // Showing a field selects it, opens the details and moves the focus to it.
    await userEvent.keyboard('{Enter}')

    const panel = await detailsPanel(canvasElement)

    await expect(
      panel.getByRole('button', { name: 'Remove link from despatchNumber to BGM/1004' }),
    ).toBeVisible()
    await waitFor(async () =>
      expect(await findRow(canvasElement, source('despatchNumber'))).toHaveFocus(),
    )

    // Enter on a link opens its menu too; it stays open for the accessibility checks.
    await openLinkMenuByKeyboard(canvasElement, 'Link from despatchNumber to BGM/1004', '{Enter}')
  },
})

export const DragOntoLinkedTarget = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    const linked = target('BGM/1004')
    const free = target('BGM/1225')

    await pressOn(await findRow(canvasElement, source('despatchDate')), 'l')
    await pressOn(await findRow(canvasElement, linked), 'l')
    await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent('already linked'))

    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()

    // A new drag clears the problem of the attempt before it.
    await startDrag(canvasElement, source('despatchDate'))
    await waitFor(() => expect(canvas.getByRole('alert')).toBeEmptyDOMElement())

    const nodeOf = (row: RowRef) => handleOf(canvasElement, row).closest('.react-flow__node')!

    await waitFor(() =>
      expect(nodeOf(linked).querySelector('[data-link-unavailable]')).not.toBeNull(),
    )
    await expect(nodeOf(free).querySelector('[data-link-unavailable]')).toBeNull()
    await expect(handleOf(canvasElement, linked)).toHaveClass('link-handle-unavailable')

    await dragOver(canvasElement, free)
    await expect(handleOf(canvasElement, free)).toHaveClass('valid')

    await dragOver(canvasElement, linked)
    await expect(handleOf(canvasElement, linked)).not.toHaveClass('valid')

    await drop(canvasElement, linked)

    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'BGM/1004 is already linked from despatchNumber. Remove that link first.',
      ),
    )
    await expect(canvasElement.querySelector('[data-link-unavailable]')).toBeNull()
    await expect(
      canvas.queryByRole('group', { name: 'Link from despatchDate to BGM/1004' }),
    ).toBeNull()
    await expectSavedLinkCount(outbound.id, 32)
  },
})

export const TargetAlreadyLinked = meta.story({
  args: { id: outbound.id },
  parameters: linkStories,
  async play({ canvas, canvasElement }) {
    await pressOn(await findRow(canvasElement, source('despatchDate')), 'l')

    const linked = await findRow(canvasElement, target('DTM+137/C507/2380'))

    await expect(linked.closest('[data-link-target]')).toBeNull()
    await expect(
      (await findRow(canvasElement, target('DTM+137/C507/2005'))).closest('[data-link-target]'),
    ).not.toBeNull()

    await pressOn(linked, 'l')

    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'DTM+137/C507/2380 is already linked from documentDate. Remove that link first.',
      ),
    )
    await expect(
      canvas.queryByRole('group', { name: 'Link from despatchDate to DTM+137/C507/2380' }),
    ).toBeNull()
    await expectSavedLinkCount(outbound.id, 32)
    await expect(
      (await openDetails(canvasElement)).getByText('Linking from despatchDate.', { exact: false }),
    ).toBeVisible()
  },
})

export const SaveErrorRollback = meta.story({
  args: { id: withoutLinks.id },
  parameters: linkStories,
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${saveMappingDraftEndpoint.path}`, async () => {
        await delay(400)

        return HttpResponse.json({ message: 'Unprocessable' }, { status: 422 })
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await pressOn(await findRow(canvasElement, target('BGM/1004')), 'l')

    await expect(
      await canvas.findByRole('group', { name: 'Link from invoiceNumber to BGM/1004' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Saving…')).toBeVisible()
    await expect(canvas.getByText(/^Unpublished changes since Version/)).toBeVisible()

    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'The link from invoiceNumber to BGM/1004 could not be saved and was taken back. Try again.',
      ),
    )
    await expect(
      canvas.queryByRole('group', { name: 'Link from invoiceNumber to BGM/1004' }),
    ).toBeNull()
    await expect(await findSaveStatus(canvasElement, 'Not saved')).toBeVisible()
    await expectSavedLinkCount(withoutLinks.id, 0)
    await expect(canvas.getByText(/^No changes since Version/)).toBeVisible()
  },
})
