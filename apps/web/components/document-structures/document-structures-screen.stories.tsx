import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { DocumentStructuresScreen } from '@/components/document-structures/document-structures-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { documentStructuresEndpoint } from '@edi-bridge/contracts'
import { createDocumentStructures, createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Document Structures/DocumentStructuresScreen',
  component: DocumentStructuresScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    const order = within(
      (await canvas.findByRole('link', { name: 'ERP purchase order' })).closest('tr')!,
    )

    await expect(order.getByText('JSON')).toBeVisible()
    await expect(order.getByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' })).toBeVisible()

    const csv = within(
      canvas.getByRole('link', { name: 'ERP dispatch export (CSV)' }).closest('tr')!,
    )

    await expect(csv.getByText('CSV')).toBeVisible()
    await expect(csv.getByText('Not used yet')).toBeVisible()
    await expect(
      await canvas.findByRole('link', { name: 'New Document Structure' }),
    ).toHaveAttribute('href', '/document-structures/new')
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Document Structures yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructuresEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Document Structures')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructuresEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document Structures unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, { documentStructures: createDocumentStructures({ count: 300 }) }),
    )
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('300 Document Structures')).toBeVisible()
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
    await expect(await canvas.findByRole('link', { name: 'ERP purchase order' })).toBeVisible()
    await expect(canvas.getAllByText('Noch nicht verwendet')[0]).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'ERP purchase order' })).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('link', { name: 'ERP purchase order' })).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'New Document Structure' })).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...createHandlers(apiUrl, { documentStructures: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText(/Document Structures appear here once an Admin creates one\./),
      ).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'New Document Structure' })).toBeNull()
    },
  }),
})
