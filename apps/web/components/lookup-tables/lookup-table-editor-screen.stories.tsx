import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent } from 'storybook/test'

import { LookupTableEditorScreen } from '@/components/lookup-tables/lookup-table-editor-screen'
import { LookupTableEntryEditor } from '@/components/lookup-tables/lookup-table-entry-editor'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { lookupTableEndpoint, updateLookupTableEndpoint } from '@edi-bridge/contracts'
import {
  createLookupTables,
  lookupTableHandlers,
  seedLookupTableNamed,
  seedLookupTables,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const unitsOfMeasure = seedLookupTableNamed('Units of measure')

const emptyTable = { ...unitsOfMeasure, id: '00000000-0000-4000-8000-0000000000e0', entries: [] }

const [largeTable] = createLookupTables({ count: 1, entryCount: 5000 })

const meta = preview.meta({
  title: 'Lookup Tables/LookupTableEditorScreen',
  component: LookupTableEditorScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: unitsOfMeasure.id },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [...seedLookupTables, emptyTable] }))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Units of measure' })).toBeVisible()
    await expect(canvas.getByRole('grid', { name: 'Entries' })).toBeVisible()
    await expect(canvas.getByRole('gridcell', { name: 'KGM' })).toBeVisible()
    await expect(canvas.getByText('4 entries')).toBeVisible()
  },
})

export const Empty = meta.story({
  args: { id: emptyTable.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No entries yet')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add entry' })).toBeEnabled()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${lookupTableEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Lookup Table')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${lookupTableEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Lookup Table unavailable')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-0000000000ff' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Lookup Table not found')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: largeTable!.id },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [largeTable!] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('5,000 entries')).toBeVisible()
    await expect(canvas.getByRole('grid', { name: 'Entries' })).toHaveAttribute(
      'aria-rowcount',
      '5001',
    )
    await expect(canvas.getAllByRole('row').length).toBeLessThan(60)
  },
})

export const OneTabStop = meta.story({
  async play({ canvas }) {
    const grid = await canvas.findByRole('grid', { name: 'Entries' })

    await userEvent.click(canvas.getByLabelText('Filter by source or target code'))
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Add entry' })).toHaveFocus()
    await userEvent.tab()
    await expect(grid.contains(document.activeElement)).toBe(true)
    await userEvent.tab()
    await expect(canvas.getByText('Keyboard shortcuts')).toHaveFocus()
  },
})

export const Saving = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.put(`${apiUrl}${updateLookupTableEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('gridcell', { name: 'KGM' }))
    await userEvent.keyboard('X{Enter}')
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))

    await expect(
      await canvas.findByText('Saving… The entries are read-only until the save finishes.'),
    ).toBeVisible()
    await expect(canvas.getByRole('grid', { name: 'Entries' })).toHaveAttribute(
      'aria-readonly',
      'true',
    )

    await userEvent.click(canvas.getByRole('gridcell', { name: 'KGMX' }))
    await expect(canvas.queryByRole('textbox', { name: /row/ })).toBeNull()
  },
})

function InvalidEntries() {
  return (
    <div className="p-6">
      <LookupTableEntryEditor
        table={{
          ...unitsOfMeasure,
          scope: { kind: 'workspace' },
          entryCount: 5,
          entries: [
            { sourceCode: 'ST', targetCode: 'PCE' },
            { sourceCode: 'KG', targetCode: '' },
            { sourceCode: 'ST', targetCode: 'PCS' },
            { sourceCode: 'L', targetCode: 'L'.repeat(71) },
            { sourceCode: ' ', targetCode: 'MTR' },
          ],
        }}
      />
    </div>
  )
}

export const ValidationErrors = meta.story({
  render: () => <InvalidEntries />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Already used in row 1.')).toBeVisible()
    await expect(canvas.getAllByText('Enter a code.')).toHaveLength(2)
    await expect(canvas.getByText('Use at most 70 characters.')).toBeVisible()
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
    await expect(await canvas.findByRole('grid', { name: 'Einträge' })).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Ausgangscode' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('grid', { name: 'Entries' })).toBeVisible()
  },
})

export const DarkValidationErrors = meta.story({
  render: () => <InvalidEntries />,
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('grid', { name: 'Entries' })).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Import CSV' })).toBeNull()
    },
  }),
})
