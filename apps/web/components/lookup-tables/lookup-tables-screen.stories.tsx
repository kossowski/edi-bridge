import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { LookupTablesScreen } from '@/components/lookup-tables/lookup-tables-screen'
import {
  expectSignedInAsViewer,
  viewerSessionHandlers,
  withViewOnlyBadge,
} from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { lookupTablesEndpoint } from '@edi-bridge/contracts'
import { createLookupTables, lookupTableHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Lookup Tables/LookupTablesScreen',
  component: LookupTablesScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('cell', { name: 'Units of measure' })).toBeVisible()
    await expect(canvas.getByRole('cell', { name: 'Hansemarkt GmbH' })).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Actions for Country codes' }),
    ).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Lookup Tables yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${lookupTablesEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Lookup Tables')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${lookupTablesEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Lookup Tables unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: createLookupTables({ count: 400 }) }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('400 Lookup Tables')).toBeVisible()
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
    await expect(await canvas.findByRole('cell', { name: 'Units of measure' })).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Geltungsbereich' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('cell', { name: 'Units of measure' })).toBeVisible()
  },
})

export const Viewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...viewerSessionHandlers())
  },
  decorators: [withViewOnlyBadge],
  async play({ canvas }) {
    await expectSignedInAsViewer(canvas)
    await expect(await canvas.findByRole('cell', { name: 'Units of measure' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'New Lookup Table' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Actions for Country codes' })).toBeNull()
    await expect(canvas.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
  },
})

export const ViewerEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(...viewerSessionHandlers(), ...lookupTableHandlers(apiUrl, { lookupTables: [] }))
  },
  decorators: [withViewOnlyBadge],
  async play({ canvas }) {
    await expectSignedInAsViewer(canvas)
    await expect(
      await canvas.findByText(/They appear here once an Admin creates one\./),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'New Lookup Table' })).toBeNull()
  },
})
