import { expect, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  findRow,
  findSaveStatus,
  pressOn,
  seeded,
  source,
  target,
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
    const panel = within(await canvas.findByRole('region', { name: 'Preview' }))
    const document = await panel.findByRole('region', { name: /^Target Document for / })

    await waitFor(() => expect(document).toHaveTextContent("UNH+1+INVOIC:D:96A:UN'"))
    await expect(document).not.toHaveTextContent('BGM')

    await pressOn(await findRow(canvasElement, source('invoiceNumber')), 'l')
    await pressOn(await findRow(canvasElement, target('BGM/1004')), 'l')

    await expect(await panel.findByText('Updating…')).toBeVisible()
    await findSaveStatus(canvasElement, 'Saved')
    await waitFor(() => expect(document).toHaveTextContent(/BGM\+\+INV-2026-\d{5}'/), {
      timeout: 5000,
    })
    await expect(panel.getByRole('status')).toHaveTextContent(/^Preview updated for /)
    await expect(panel.getByText('Up to date')).toBeVisible()
  },
})
