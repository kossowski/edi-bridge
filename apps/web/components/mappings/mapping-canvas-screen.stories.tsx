import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { documentStructureEndpoint, mappingDraftEndpoint } from '@edi-bridge/contracts'
import {
  createDocumentStructure,
  createHandlers,
  createMappingDrafts,
  seedMappingDrafts,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedMappingDrafts.find((draft) => draft.name === name && draft.latestVersion !== null)!
}

const inbound = seeded('Hansemarkt: ORDERS to ERP JSON')

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const largeStructure = createDocumentStructure({ fieldCount: 400 })

const [, , largeDraft] = createMappingDrafts({ count: 3, documentStructures: [largeStructure] })

// The tooltip renders in a portal outside the story's root.
function page(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

async function findRow(canvasElement: HTMLElement, id: string) {
  return waitFor(() => {
    const row = canvasElement.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)

    if (!row) {
      throw new Error(`No row ${id}`)
    }

    return row
  })
}

async function findTooltip(canvasElement: HTMLElement) {
  const tooltip = await page(canvasElement).findByRole('tooltip')

  await waitFor(() => expect(tooltip).toBeVisible())

  return within(tooltip)
}

function detailsPanel(canvasElement: HTMLElement, name = 'Meaning') {
  return within(page(canvasElement).getByRole('region', { name }))
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
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ERP JSON to DESADV' }),
    ).toBeVisible()
    await expect(canvas.getByText('Outbound: Document Structure to Message Type')).toBeVisible()
    await expect(canvas.getByText('18 links')).toBeVisible()
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()
    await expect(canvas.getByText('UNH')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from despatchNumber to BGM/1004' }),
    ).toBeInTheDocument()
  },
})

export const Inbound = meta.story({
  args: { id: inbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
    await expect(canvas.getByText('Inbound: Message Type to Document Structure')).toBeVisible()
    await expect(await canvas.findByText('orderNumber')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()
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
      await canvas.findByRole('img', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()
  },
})

const desktopViewports = {
  viewport: {
    options: {
      laptop: { name: 'Laptop', styles: { width: '1024px', height: '900px' } },
      desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
    },
  },
  a11y: { config: { rules: [{ id: 'target-size', enabled: true }] } },
}

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

async function expectClearTargets(canvasElement: HTMLElement, zoom: string) {
  const viewport = canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!

  await waitFor(() => expect(viewport.style.transform).toContain(`scale(${zoom})`))

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
    await expectClearTargets(canvasElement, '1')
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
    await expectClearTargets(canvasElement, '0.85')
  },
})

export const EmptyDraft = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('No links yet')).toBeVisible()
    await expect(await canvas.findByText('invoiceNumber')).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow__edge')).toBeNull()
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
      expect(canvasElement.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0),
    )

    // Every part is rendered, also those out of view, so that each one can get keyboard focus.
    const nodes = canvasElement.querySelectorAll('.react-flow__node')

    await expect(nodes.length).toBeGreaterThan(400)

    const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-row-id]')]

    await expect(rows.length).toBe(nodes.length - 2)
    await expect(rows.every((row) => row.tabIndex === 0)).toBe(true)
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
            { kind: 'object', path: 'header', name: 'header', required: true, children: [] },
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
    await expect(canvasElement.querySelector('.react-flow__edge')).toBeNull()
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
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Eingehend: Message Type zu Document Structure'),
    ).toBeVisible()
    await expect(await canvas.findByText('Nachrichtenkopf')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Verknüpfung von BGM/1004 zu orderNumber' }),
    ).toBeInTheDocument()
  },
})

export const Dark = meta.story({
  args: { id: outbound.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()
  },
})

export const HoverMeaning = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.hover(await findRow(canvasElement, 'source:DTM+137'))

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
    const row = await findRow(canvasElement, 'target:DTM+137')

    await userEvent.hover(row)

    const tooltip = await findTooltip(canvasElement)

    await expect(tooltip.getByText('Document/message date/time')).toBeVisible()
    await expect(row).toHaveAccessibleDescription(/Document\/message date\/time/)
  },
})

export const KeyboardFocusMeaning = meta.story({
  args: { id: inbound.id },
  async play({ canvas, canvasElement }) {
    const row = await findRow(canvasElement, 'source:DTM+137')
    const panel = detailsPanel(canvasElement)

    canvas.getByRole('button', { name: 'Collapse DTM+137' }).focus()
    await userEvent.tab()
    await expect(row).toHaveFocus()
    await expect(
      (await findTooltip(canvasElement)).getByText('Document/message date/time'),
    ).toBeVisible()

    await userEvent.keyboard('{Enter}')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByText('Document/message date/time')).toBeVisible()

    await userEvent.tab({ shift: true })
    await userEvent.tab()
    await findTooltip(canvasElement)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('tooltip')).toBeNull())
    await expect(row).toHaveFocus()
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    await userEvent.keyboard('{Escape}')
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await expect(panel.getByText('Select a part', { exact: false })).toBeVisible()

    await userEvent.keyboard(' ')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
  },
})

export const SelectedRow = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, 'source:DTM+137')
    const panel = detailsPanel(canvasElement)

    await expect(panel.getByText('Select a part', { exact: false })).toBeVisible()

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByText('Document/message date/time')).toBeVisible()
    await expect(panel.getByText('Source')).toBeVisible()

    await userEvent.click(panel.getByRole('button', { name: 'Clear selection' }))
    await expect(row).toHaveAttribute('aria-pressed', 'false')
    await expect(row).toHaveFocus()

    await userEvent.click(row)
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(await findRow(canvasElement, 'target:orderNumber'))
    await expect(panel.getByText('Target')).toBeVisible()
    await expect(panel.getByText('Required')).toBeVisible()
  },
})

export const QualifiedGroup = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.hover(await findRow(canvasElement, 'source:SG2+BY'))

    const tooltip = await findTooltip(canvasElement)

    await expect(tooltip.getByText('Name and address')).toBeVisible()
    await expect(tooltip.getByText('Buyer')).toBeVisible()

    await userEvent.click(await findRow(canvasElement, 'source:SG2+BY/NAD+BY'))

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByText('NAD+BY')).toBeVisible()
    await expect(panel.getByText('Buyer')).toBeVisible()
  },
})

export const CodedElement = meta.story({
  args: { id: inbound.id },
  async play({ canvasElement }) {
    await userEvent.click(await findRow(canvasElement, 'source:DTM+137/C507/2379'))

    const panel = detailsPanel(canvasElement)

    await expect(panel.getByText('Date/time/period format qualifier')).toBeVisible()
    await expect(
      panel.getByText('(alphanumeric, up to 3 characters)', { exact: false }),
    ).toBeVisible()
    await expect(panel.getByText('CCYYMMDD')).toBeVisible()
    await expect(panel.getByText('CCYYMMDDHHMM')).toBeVisible()
  },
})

export const MeaningGerman = meta.story({
  args: { id: inbound.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, 'source:DTM+137')

    await userEvent.click(row)

    const panel = detailsPanel(canvasElement, 'Bedeutung')

    await expect(panel.getByText('Dokumenten-/Nachrichtendatum/-zeit')).toBeVisible()
    await expect(panel.getByText('Muss')).toBeVisible()

    await userEvent.hover(row)
    await expect((await findTooltip(canvasElement)).getByText('Einmal')).toBeVisible()
  },
})

export const MeaningDark = meta.story({
  args: { id: outbound.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, 'target:DTM+137')

    await userEvent.click(row)
    await expect(detailsPanel(canvasElement).getByText('Document/message date/time')).toBeVisible()
    await userEvent.hover(row)
    await findTooltip(canvasElement)
  },
})
