import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, screen, waitFor } from 'storybook/test'

import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import messagesDe from '@/messages/de.json'
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
