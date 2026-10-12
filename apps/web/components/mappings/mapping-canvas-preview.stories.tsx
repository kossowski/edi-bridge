import { expect, userEvent, waitFor } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  openEmptyEditor,
  findRow,
  findSaveStatus,
  page,
  pressOn,
  seeded,
  source,
  target,
  findSheet,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/Preview',
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

export const UpdatesAfterChange = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await openEmptyEditor(canvasElement)

    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }))

    const panel = await findSheet(canvasElement, 'Preview')
    const document = await panel.findByRole('region', { name: /^Target Document for / })

    await waitFor(() => expect(document).toHaveTextContent("UNH+1+INVOIC:D:96A:UN'"))
    await expect(document).not.toHaveTextContent('BGM')

    await userEvent.click(panel.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await pressOn(await findRow(canvasElement, target('BGM/1004')), 'l')
    await findSaveStatus(canvasElement, 'Saved')
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }))

    const reopened = await findSheet(canvasElement, 'Preview')
    const updated = await reopened.findByRole('region', { name: /^Target Document for / })

    await waitFor(() => expect(updated).toHaveTextContent(/BGM\+\+INV-2026-\d{5}'/), {
      timeout: 5000,
    })
    await expect(reopened.getByText('Up to date')).toBeVisible()
  },
})
