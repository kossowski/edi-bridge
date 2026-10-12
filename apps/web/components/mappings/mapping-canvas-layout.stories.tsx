import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  openEmptyEditor,
  expectTransformCount,
  findRow,
  findSaveStatus,
  liveStatus,
  openDetails,
  page,
  pressOn,
  seeded,
  source,
  findSheet,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { transformsHiddenKey } from '@/components/mappings/transform-list'
import { viewerStory } from '@/components/session/session-story-helpers'
import { laptop } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingVersionsEndpoint, type MappingVersionEntry } from '@edi-bridge/contracts'
import { createHandlers, createMappingVersions } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

function forgetHiddenList() {
  window.localStorage.removeItem(transformsHiddenKey)

  return () => window.localStorage.removeItem(transformsHiddenKey)
}

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/Layout',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: outbound.id },
  decorators: [
    (Story) => (
      <div className="flex min-h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))

    return forgetHiddenList()
  },
})

export const Toolbar = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText(/^No changes since Version/)).toBeVisible()
    await expect(canvas.getByText('Draft')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Preview' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.getByRole('button', { name: 'Versions & problems' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Publish/ })).toBeVisible()
    await expect(await canvas.findByRole('heading', { name: 'Add a Transform' })).toBeVisible()
  },
})

function shownTooltips(canvasElement: HTMLElement) {
  return [
    ...canvasElement.ownerDocument.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]'),
  ].filter((tooltip) => tooltip.checkVisibility())
}

// Below 90rem the toolbar shows icons, so a tooltip names each one; moving along them by keyboard
// shows only the name of the focused one, not the fading names of those left behind.
export const ToolbarTooltipsOneAtATime = meta.story({
  ...laptop,
  async play({ canvas, canvasElement }) {
    const draft = await canvas.findByRole('button', { name: 'Draft with AI' })

    draft.focus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    for (const name of ['Draft with AI', 'Preview', 'Details', 'Versions & problems']) {
      await userEvent.tab()
      await expect(shownTooltips(canvasElement).length).toBeLessThanOrEqual(1)
      await waitFor(() =>
        expect(shownTooltips(canvasElement).map((tooltip) => tooltip.textContent)).toEqual([name]),
      )
    }
  },
})

export const DetailsFromToolbar = meta.story({
  async play({ canvas, canvasElement }) {
    await canvas.findByText('despatchNumber')

    const details = await openDetails(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Details' })

    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(details.getByText('Outbound: data format to Message Type')).toBeVisible()
    await waitFor(() => expect(details.getByRole('group', { name: 'Details' })).toHaveFocus())

    // The details open inside the canvas's frame, below the toolbar, whose buttons stay in reach.
    const panel = page(canvasElement).getByRole('dialog', { name: 'Details' })

    await expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      trigger.getBoundingClientRect().bottom,
    )

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
})

export const DetailsToggle = meta.story({
  async play({ canvas, canvasElement }) {
    await canvas.findByText('despatchNumber')

    const trigger = canvas.getByRole('button', { name: 'Details' })

    await openDetails(canvasElement)
    await userEvent.click(trigger)
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
})

export const DetailsShowSelection = meta.story({
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, source('despatchNumber'))

    // A selected row leaves the details closed, so they never cover the target tree unasked.
    await userEvent.click(row)
    await expect(row).toHaveFocus()
    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()

    const details = await openDetails(canvasElement)

    await expect(details.getByText('Source')).toBeVisible()
  },
})

export const PendingLinkKeepsDetailsClosed = meta.story({
  async play({ canvasElement }) {
    await pressOn(await findRow(canvasElement, source('despatchNumber')), 'l')
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Linking from despatchNumber.'),
    )
    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()
  },
})

export const HideTransforms = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    await userEvent.click(await canvas.findByRole('button', { name: 'Hide the Transforms' }))

    const show = canvas.getByRole('button', { name: 'Show the Transforms' })

    await waitFor(() => expect(show).toHaveFocus())
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await expect(window.localStorage.getItem(transformsHiddenKey)).toBe('true')
    await expect(canvas.queryByText('Click to add, or drag onto the canvas.')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Add Date format' }))
    await expect(
      await canvas.findByRole('group', { name: 'Transform Date format 1' }),
    ).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    await userEvent.click(show)
    await expect(await canvas.findByText('Click to add, or drag onto the canvas.')).toBeVisible()
    await expect(window.localStorage.getItem(transformsHiddenKey)).toBe('false')
  },
})

export const TransformsRemainHidden = meta.story({
  beforeEach() {
    window.localStorage.setItem(transformsHiddenKey, 'true')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Show the Transforms' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add Constant' })).toBeVisible()
  },
})

export const DropTransform = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    const add = await canvas.findByRole('button', { name: 'Add Concatenate' })
    const pane = canvasElement.querySelector<HTMLElement>('.mapping-canvas')!
    const box = pane.getBoundingClientRect()
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }
    // A synthetic drag carries no DataTransfer of its own, so this one keeps the data between events.
    const data = new Map<string, string>()

    const dataTransfer = {
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      get types() {
        return [...data.keys()]
      },
    }

    const drag = (element: HTMLElement, type: string) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, ...at })

      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      element.dispatchEvent(event)
    }

    await expectTransformCount(canvasElement, 0)
    drag(add, 'dragstart')
    drag(pane, 'dragover')
    drag(pane, 'drop')

    const placed = await canvas.findByRole('group', { name: 'Transform Concatenate 1' })
    const header = placed.getBoundingClientRect()

    await expect(Math.abs(header.left + header.width / 2 - at.clientX)).toBeLessThan(header.width)
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expectTransformCount(canvasElement, 1)
  },
})

const changedOutbound = { ...outbound, unpublishedChanges: true }

const partners = [
  'Nordwind',
  'Alpenfrisch',
  'Elbtal',
  'Rheinkauf',
  'Hansemarkt',
  'Ostsee',
  'Moselland',
  'Isartal',
]

const manyFlows: MappingVersionEntry[] = createMappingVersions([changedOutbound]).map(
  ({ id, mappingId, mappingName, version, publishedAt, changeNote, publishedBy }) => ({
    id,
    mappingId,
    mappingName,
    version,
    publishedAt,
    changeNote,
    publishedBy,
    flows:
      version === changedOutbound.latestVersion
        ? partners.map((partner) => ({
            id: crypto.randomUUID(),
            name: 'Despatch advice by AS2',
            tradingPartner: {
              id: crypto.randomUUID(),
              name: `${partner} Großhandel GmbH & Co. KG`,
            },
          }))
        : [],
  }),
)

export const PublishManyRoutes = meta.story({
  ...laptop,
  args: { id: changedOutbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingVersionsEndpoint.path}`, () => HttpResponse.json(manyFlows)),
      ...createHandlers(apiUrl, { mappingDrafts: [changedOutbound] }),
    )
  },
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: /^Publish/ }))

    const dialog = await page(canvasElement).findByRole('dialog', { name: /^Publish Version/ })

    await expect(
      await within(dialog).findByText('8 document routes keep their versions until you move them.'),
    ).toBeInTheDocument()
    await expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)

    const last = within(dialog).getAllByRole('checkbox').at(-1)!

    last.focus()
    await userEvent.keyboard(' ')
    await expect(last).toBeChecked()
    await expect(last).toBeVisible()
    await expect(
      within(dialog).getByText('7 document routes keep their versions until you move them.'),
    ).toBeInTheDocument()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('button', { name: 'Preview' })).toBeVisible()
      await expect(canvas.getByRole('button', { name: 'Details' })).toBeVisible()
      await expect(canvas.getByRole('button', { name: 'Versions & problems' })).toBeVisible()
      await expect(canvas.queryByRole('heading', { name: 'Add a Transform' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Publish/ })).toBeNull()
    },
  }),
})

export const SmallScreenDetails = meta.story({
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Details' }))

    const details = await findSheet(canvasElement, 'Details')

    await expect(details.getByText('Outbound: data format to Message Type')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Vorschau' })).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Transforms ausblenden' })).toBeVisible()
    await expect(
      canvas.getByText(
        'Klicken Sie zum Hinzufügen, oder ziehen Sie einen Transform auf die Zeichenfläche.',
      ),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    const details = await openDetails(canvasElement)

    await expect(details.getByText('30 links')).toBeVisible()
  },
})
