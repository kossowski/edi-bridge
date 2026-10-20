import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  findAlert,
  findRow,
  findSheet,
  openDetails,
  seeded,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import { page } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const empty = seeded('Rheinkauf: ERP JSON to INVOIC')

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/StartHere',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: empty.id },
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

export const StartHere = meta.story({
  async play({ canvas, canvasElement }) {
    const start = within(await canvas.findByRole('region', { name: 'Start here' }))

    await expect(
      start.getByRole('heading', { name: 'AI draft from an example document' }),
    ).toBeVisible()
    await expect(start.getByText('Recommended')).toBeVisible()
    await expect(start.getByRole('heading', { name: 'Link the fields yourself' })).toBeVisible()
    await expect(start.getAllByRole('listitem')).toHaveLength(3)
    await expect(canvasElement.querySelector('.react-flow')).toBeNull()

    // Without the canvas, the details open as a sheet.
    await expect((await openDetails(canvasElement)).getByText('No links yet')).toBeVisible()
  },
})

export const ChooseAiDraft = meta.story({
  async play({ canvas, canvasElement }) {
    const start = await canvas.findByRole('button', { name: 'Start an AI draft' })

    await userEvent.click(start)

    const dialog = await findSheet(canvasElement, 'Draft with AI')

    await expect(await dialog.findByRole('combobox', { name: 'Example document' })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('heading', { name: 'Start here' })).toBeVisible()
  },
})

export const ChooseLinkYourself = meta.story({
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Open the empty editor' }))

    const first = await findRow(canvasElement, { side: 'source', path: 'invoiceNumber' })

    await waitFor(() => expect(first).toHaveFocus())
    await expect(canvas.queryByRole('heading', { name: 'Start here' })).toBeNull()
    await expect(canvasElement.querySelector('.react-flow__edge')).toBeNull()
  },
})

// The failed document's field is shown in the empty editor, which leaves "Start here".
export const FailingField = meta.story({
  args: { field: 'invoiceNumber' },
  async play({ canvas, canvasElement }) {
    const alert = await findAlert(canvasElement, 'A document failed at invoiceNumber')

    await expect(alert.queryByText(/shown on the canvas/)).toBeNull()
    await expect(alert.queryByText(/1024 pixels/)).toBeNull()
    await expect(canvas.getByRole('heading', { name: 'Start here' })).toBeVisible()
    await userEvent.click(alert.getByRole('button', { name: 'Show the field' }))

    const row = await findRow(canvasElement, { side: 'source', path: 'invoiceNumber' })

    await waitFor(() => expect(row).toHaveFocus())
    await expect(row.closest('[data-failing]')).toHaveAttribute('data-failing', 'field')
    await expect(canvas.queryByRole('heading', { name: 'Start here' })).toBeNull()
    await expect(alert.getByText(/It is selected and shown on the canvas\./)).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await findRow(canvasElement, { side: 'source', path: 'invoiceNumber' })
      await expect(canvas.queryByRole('heading', { name: 'Start here' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Open the empty editor' })).toBeNull()
      await expect(canvas.getByText('Nothing is linked yet.')).toBeVisible()
    },
  }),
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
    await expect(await canvas.findByRole('heading', { name: 'Hier beginnen' })).toBeVisible()
    await expect(canvas.getByText('Entwurf')).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'KI-Entwurf aus einem Beispielbeleg' }),
    ).toBeVisible()
    await expect(canvas.getByText('Empfohlen')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'KI-Entwurf starten' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Leeren Editor öffnen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Start here' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Start an AI draft' })).toBeVisible()
  },
})

export const SmallScreen = meta.story({
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Start here' })).toBeNull()
    await expect(canvasElement.querySelector('.react-flow')).toBeNull()
  },
})
