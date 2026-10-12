import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, screen, waitFor } from 'storybook/test'

import { LookupTableFormDialog } from '@/components/lookup-tables/lookup-table-form-dialog'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  seedLookupTableNamed,
  seedTradingPartners,
  toLookupTableSummary,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const tradingPartnerNames = {
  get: (id: string) => seedTradingPartners.find((tradingPartner) => tradingPartner.id === id),
}

const hansemarktUnits = toLookupTableSummary(
  seedLookupTableNamed('Hansemarkt units'),
  tradingPartnerNames,
)

// Waits out the opening fade, so visibility checks see the settled dialog.
async function dialog() {
  const element = await screen.findByRole('dialog')
  await waitFor(() => expect(element).toBeVisible())

  return element
}

const meta = preview.meta({
  title: 'Lookup Tables/LookupTableFormDialog',
  component: LookupTableFormDialog,
  args: {
    open: true,
    table: null,
    finalFocus: { current: null },
    onOpenChange: fn(),
    onSaved: fn(),
  },
  // The dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
})

export const Create = meta.story({
  async play() {
    await dialog()
    await expect(screen.getByRole('heading', { name: 'New list' })).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('')
    await expect(screen.getByRole('radio', { name: 'Sent to every partner' })).toBeChecked()
    await expect(screen.getByText('Every partner gets the translated codes.')).toBeVisible()
  },
})

export const EditTradingPartnerScope = meta.story({
  args: { table: hansemarktUnits },
  async play() {
    await dialog()
    await expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Hansemarkt units')
    await expect(
      screen.getByText('Only the chosen trading partner gets the translated codes.'),
    ).toBeVisible()
    const tradingPartner = await screen.findByRole('combobox', { name: 'Trading partner' })
    await waitFor(() => expect(tradingPartner).toHaveTextContent('Hansemarkt GmbH'))
  },
})

export const NoTradingPartners = meta.story({
  args: { table: hansemarktUnits },
  beforeEach({ msw }) {
    msw.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))
  },
  async play() {
    await dialog()
    await expect(await screen.findByText(/There are no trading partners yet/)).toBeVisible()
  },
})

export const German = meta.story({
  args: { table: hansemarktUnits },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play() {
    await dialog()
    await expect(screen.getByRole('heading', { name: 'Hansemarkt units bearbeiten' })).toBeVisible()
    await expect(screen.getByRole('radio', { name: 'Nur für einen Handelspartner' })).toBeChecked()
  },
})

export const Dark = meta.story({
  args: { table: hansemarktUnits },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play() {
    await dialog()
    const tradingPartner = await screen.findByRole('combobox', { name: 'Trading partner' })
    await waitFor(() => expect(tradingPartner).toHaveTextContent('Hansemarkt GmbH'))
  },
})
