import { http, HttpResponse } from 'msw'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { findOpenDialog, german, waitForFocusInside } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  deleteLookupTableEndpoint,
  lookupTableInUseMessage,
  lookupTableInUseStatus,
  toPath,
} from '@edi-bridge/contracts'
import { seedLookupTableNamed, seedTradingPartners, toLookupTableSummary } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const units = toLookupTableSummary(seedLookupTableNamed('Units of measure'), {
  get: (id) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
})

async function dialog(canvasElement: HTMLElement) {
  const element = await findOpenDialog(canvasElement, new RegExp(units.name))
  // A click before the dialog takes the focus can land on the page behind it.
  await waitForFocusInside(element)

  return element
}

const meta = preview.meta({
  title: 'Lookup Tables/DeleteLookupTableDialog',
  component: DeleteLookupTableDialog,
  args: {
    open: true,
    table: units,
    finalFocus: { current: null },
    onOpenChange: fn(),
    onDeleted: fn(),
  },
  // The dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
})

export const Default = meta.story({
  async play({ canvasElement }) {
    await dialog(canvasElement)
    await expect(
      screen.getByText('The code translation and its 4 values are deleted. This cannot be undone.'),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  },
})

const refuseInUse = http.delete(
  `${apiUrl}${toPath(deleteLookupTableEndpoint.path, { id: units.id })}`,
  () =>
    HttpResponse.json(
      { status: lookupTableInUseStatus, message: lookupTableInUseMessage },
      { status: lookupTableInUseStatus },
    ),
)

export const InUse = meta.story({
  beforeEach({ msw }) {
    msw.use(refuseInUse)
  },
  async play({ args, canvasElement }) {
    await dialog(canvasElement)
    await userEvent.click(screen.getByRole('button', { name: 'Delete code translation' }))

    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'A draft or a published version of a mapping uses this code translation, so it cannot be deleted.',
    )
    await expect(screen.queryByText(/Try again/)).toBeNull()
    const confirm = screen.getByRole('button', { name: 'Delete code translation' })

    await expect(confirm).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm).toHaveFocus()
    await expect(args.onDeleted).not.toHaveBeenCalled()
  },
})

export const GermanInUse = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(refuseInUse)
  },
  async play({ canvasElement }) {
    await dialog(canvasElement)
    await userEvent.click(screen.getByRole('button', { name: 'Code-Übersetzung löschen' }))

    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ein Entwurf oder eine veröffentlichte Version eines Mappings verwendet diese Code-Übersetzung, deshalb kann sie nicht gelöscht werden.',
    )
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvasElement }) {
    await dialog(canvasElement)
    await expect(screen.getByRole('button', { name: 'Code-Übersetzung löschen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    await dialog(canvasElement)
    await expect(screen.getByRole('button', { name: 'Delete code translation' })).toBeVisible()
  },
})
