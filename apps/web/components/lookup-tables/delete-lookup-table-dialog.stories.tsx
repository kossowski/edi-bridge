import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  deleteLookupTableEndpoint,
  lookupTableInUseMessage,
  lookupTableInUseStatus,
} from '@edi-bridge/contracts'
import { seedLookupTableNamed, seedTradingPartners, toLookupTableSummary } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const units = toLookupTableSummary(seedLookupTableNamed('Units of measure'), {
  get: (id) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
})

// Waits out the opening fade, so visibility checks see the settled dialog.
async function dialog() {
  const element = await screen.findByRole('dialog')
  await waitFor(() => expect(element).toBeVisible())

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
  async play() {
    await dialog()
    await expect(
      screen.getByText('The list and its 4 values are deleted. This cannot be undone.'),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  },
})

const refuseInUse = http.delete(
  `${apiUrl}${deleteLookupTableEndpoint.path.replace(':id', units.id)}`,
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
  async play({ args }) {
    await dialog()
    await userEvent.click(screen.getByRole('button', { name: 'Delete list' }))

    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'A mapping or one of its published versions uses this list, so it cannot be deleted.',
    )
    await expect(screen.queryByText(/Try again/)).toBeNull()
    const confirm = screen.getByRole('button', { name: 'Delete list' })

    await expect(confirm).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm).toHaveFocus()
    await expect(args.onDeleted).not.toHaveBeenCalled()
  },
})

export const GermanInUse = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(refuseInUse)
  },
  async play() {
    await dialog()
    await userEvent.click(screen.getByRole('button', { name: 'Liste löschen' }))

    await expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ein Mapping oder eine seiner veröffentlichten Versionen verwendet diese Liste, deshalb kann sie nicht gelöscht werden.',
    )
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
  async play() {
    await dialog()
    await expect(screen.getByRole('button', { name: 'Liste löschen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play() {
    await dialog()
    await expect(screen.getByRole('button', { name: 'Delete list' })).toBeVisible()
  },
})
