import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  expectTransformCount,
  findRow,
  findSaveStatus,
  openDetails,
  page,
  seeded,
  source,
  findSheet,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const hiddenKey = 'edi-bridge:mapping-editor:transforms-hidden'

function forgetHiddenList() {
  window.localStorage.removeItem(hiddenKey)

  return () => window.localStorage.removeItem(hiddenKey)
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
    await expect(canvas.getByRole('link', { name: 'Mapping Versions' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Publish/ })).toBeVisible()
    await expect(await canvas.findByRole('heading', { name: 'Add a Transform' })).toBeVisible()
  },
})

export const DetailsFromToolbar = meta.story({
  async play({ canvas, canvasElement }) {
    await canvas.findByText('despatchNumber')

    const details = await openDetails(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Details' })

    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(details.getByText('Outbound: Document Structure to Message Type')).toBeVisible()
    await waitFor(() => expect(details.getByRole('group', { name: 'Details' })).toHaveFocus())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
})

export const DetailsFollowSelection = meta.story({
  async play({ canvasElement }) {
    const row = await findRow(canvasElement, source('despatchNumber'))

    await userEvent.click(row)

    const details = await findSheet(canvasElement, 'Details')

    await expect(details.getByText('Source')).toBeVisible()
    await expect(row).toHaveFocus()

    // The sheet keeps the canvas usable: Escape on the canvas clears the selection, and the sheet
    // that showed it goes.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(row).toHaveFocus()
  },
})

export const HideTransforms = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Hide the Transforms' }))

    const show = canvas.getByRole('button', { name: 'Show the Transforms' })

    await waitFor(() => expect(show).toHaveFocus())
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await expect(window.localStorage.getItem(hiddenKey)).toBe('true')
    await expect(canvas.queryByText('Click to add, or drag onto the canvas.')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Add Date format' }))
    await expect(
      await canvas.findByRole('group', { name: 'Transform Date format 1' }),
    ).toBeVisible()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    await userEvent.click(show)
    await expect(await canvas.findByText('Click to add, or drag onto the canvas.')).toBeVisible()
    await expect(window.localStorage.getItem(hiddenKey)).toBe('false')
  },
})

export const TransformsRemainHidden = meta.story({
  beforeEach() {
    window.localStorage.setItem(hiddenKey, 'true')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Show the Transforms' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add Constant' })).toBeVisible()
  },
})

export const DropTransform = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
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

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('button', { name: 'Preview' })).toBeVisible()
      await expect(canvas.getByRole('button', { name: 'Details' })).toBeVisible()
      await expect(canvas.getByRole('link', { name: 'Mapping Versions' })).toBeVisible()
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

    await expect(details.getByText('Outbound: Document Structure to Message Type')).toBeVisible()
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
