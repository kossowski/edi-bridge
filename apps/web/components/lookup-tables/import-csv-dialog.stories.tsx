import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { ImportCsvDialog } from '@/components/lookup-tables/import-csv-dialog'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { importLookupTableEndpoint, lookupTableImportPreviewEndpoint } from '@edi-bridge/contracts'
import { createLookupTables, lookupTableHandlers, seedLookupTableNamed } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const unitsOfMeasure = seedLookupTableNamed('Units of measure')

const [largeTable] = createLookupTables({ count: 1, entryCount: 5000 })

const everyStatusCsv = [
  'source;target',
  'ST;PCE',
  'KG;KGS',
  'MTR;MTR',
  ';LTR',
  'CMT;CMT;cm',
  'MTR;M',
].join('\n')

const largeCsv = [
  ...largeTable!.entries
    .slice(0, 3000)
    .map(({ sourceCode, targetCode }, index) =>
      index % 2 === 0 ? `${sourceCode};${targetCode}` : `${sourceCode};${targetCode}2`,
    ),
  ...Array.from({ length: 1000 }, (_, index) => `NEW${index};N${index}`),
  ...Array.from({ length: 20 }, (_, index) => `BAD${index}`),
].join('\n')

// Waits out the opening fade, so visibility checks see the settled dialog.
async function dialog() {
  const element = await screen.findByRole('dialog')
  await waitFor(() => expect(element).toBeVisible())

  return element
}

function visibleText(text: string) {
  return screen.getAllByText(text).find((element) => element.checkVisibility())
}

async function requestPreview(
  csv: string,
  { textLabel = 'CSV text', previewLabel = 'Preview import' } = {},
) {
  await dialog()
  await userEvent.click(screen.getByLabelText(textLabel))
  await userEvent.paste(csv)
  await userEvent.click(screen.getByRole('button', { name: previewLabel }))
}

const meta = preview.meta({
  title: 'Lookup Tables/ImportCsvDialog',
  component: ImportCsvDialog,
  args: {
    table: unitsOfMeasure,
    direction: 'inbound' as const,
    open: true,
    onOpenChange: fn(),
    onImported: fn(),
  },
  // The dialog renders in a portal outside the story root.
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [unitsOfMeasure, largeTable!] }))
  },
})

export const Empty = meta.story({
  async play() {
    await dialog()
    await expect(screen.getByText(/keeps every value missing from the CSV/)).toBeVisible()
    await expect(screen.getByLabelText('CSV file')).toBeVisible()
    await expect(screen.getByLabelText('CSV text')).toHaveValue('')
  },
})

export const MissingCsv = meta.story({
  async play() {
    await dialog()
    await userEvent.click(screen.getByRole('button', { name: 'Preview import' }))
    await expect(screen.getByText('Choose a CSV file or paste CSV text.')).toBeVisible()
    await expect(screen.getByLabelText('CSV text')).toHaveFocus()
  },
})

export const Preview = meta.story({
  async play() {
    await requestPreview(everyStatusCsv)

    await expect(await screen.findByRole('heading', { name: 'Preview' })).toHaveFocus()
    await expect(screen.getByRole('button', { name: 'Added 1' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Changed 1' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Unchanged 1' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Invalid 3' })).toBeVisible()
    await expect(screen.getByText('changed from KGM to KGS')).toBeInTheDocument()
    await expect(
      screen.getByRole('columnheader', { name: 'What the partner sends' }),
    ).toBeInTheDocument()
    await expect(visibleText('The partner’s code is missing.')).toBeVisible()
    await expect(visibleText('Needs exactly two columns.')).toBeVisible()
    await expect(visibleText('The partner’s code already occurs in an earlier line.')).toBeVisible()
  },
})

export const OutgoingPreview = meta.story({
  args: { direction: 'outbound' as const },
  async play() {
    await requestPreview(everyStatusCsv)

    await expect(await screen.findByRole('heading', { name: 'Preview' })).toHaveFocus()
    await expect(screen.getByRole('columnheader', { name: 'Your value' })).toBeInTheDocument()
    await expect(
      screen.getByRole('columnheader', { name: 'What the partner gets' }),
    ).toBeInTheDocument()
    await expect(visibleText('Your value is missing.')).toBeVisible()
  },
})

export const LargePreview = meta.story({
  args: { table: largeTable! },
  async play() {
    await requestPreview(largeCsv)

    await expect(await screen.findByText('Showing 200 of 4,020 lines')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Added 1,000' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Changed 1,500' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Show 200 more lines' })).toBeVisible()
  },
})

export const ShowAllLines = meta.story({
  args: { table: largeTable! },
  async play() {
    await requestPreview(largeCsv)
    await userEvent.click(await screen.findByRole('button', { name: 'Added 1,000' }))

    for (let page = 0; page < 4; page++) {
      await userEvent.click(screen.getByRole('button', { name: 'Show 200 more lines' }))
    }

    await expect(await screen.findByText('Showing 1,000 of 1,000 lines')).toBeVisible()
    await expect(screen.queryByRole('button', { name: /more lines/ })).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toHaveTextContent('NEW800'))
    await expect(document.activeElement?.tagName).toBe('TR')
  },
})

export const NothingToApply = meta.story({
  async play() {
    await requestPreview('ST;PCE\nKG;')

    await expect(await screen.findByText(/there is nothing to apply/)).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled()
  },
})

export const PreviewError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${lookupTableImportPreviewEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    await requestPreview(everyStatusCsv)

    await expect(
      await screen.findByText('The preview could not be loaded. Try again.'),
    ).toBeVisible()
  },
})

export const Previewing = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${lookupTableImportPreviewEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play() {
    await requestPreview(everyStatusCsv)

    await expect(screen.getByRole('button', { name: 'Loading preview…' })).toBeDisabled()
  },
})

export const ReadFailed = meta.story({
  async play() {
    await dialog()
    const file = new File(['ST;PCE'], 'units.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('unreadable')) })
    await userEvent.upload(screen.getByLabelText('CSV file'), file)

    await expect(
      await screen.findByText('The file could not be read. Choose another file.'),
    ).toBeVisible()
    await expect(screen.getByLabelText('CSV file')).toHaveFocus()
    await expect(screen.getByLabelText('CSV file')).toHaveAttribute('aria-invalid', 'true')
  },
})

export const ApplyFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${importLookupTableEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    await requestPreview(everyStatusCsv)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply import' }))

    await expect(
      await screen.findByText('The import could not be applied. Try again.'),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled()
  },
})

export const Applying = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${importLookupTableEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play() {
    await requestPreview(everyStatusCsv)
    await userEvent.click(await screen.findByRole('button', { name: 'Apply import' }))

    await expect(screen.getByRole('button', { name: 'Applying import…' })).toBeDisabled()
    await expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
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
    await requestPreview(everyStatusCsv, {
      textLabel: 'CSV-Text',
      previewLabel: 'Vorschau anzeigen',
    })

    await expect(await screen.findByRole('button', { name: 'Neu 1' })).toBeVisible()
    await expect(visibleText('Der Code des Partners fehlt.')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play() {
    await requestPreview(everyStatusCsv)

    await expect(await screen.findByRole('button', { name: 'Invalid 3' })).toBeVisible()
  },
})
