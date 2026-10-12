import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, within } from 'storybook/test'

import { DocumentStructuresScreen } from '@/components/document-structures/document-structures-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
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

function cardOf(heading: HTMLElement) {
  return within(heading.closest('[data-slot="card"]')!)
}

export const Default = meta.story({
  async play({ canvas }) {
    const order = cardOf(await canvas.findByRole('heading', { name: 'ERP purchase order' }))

    await expect(order.getByText('JSON')).toBeVisible()
    await expect(order.getByText('order-4711.json')).toBeVisible()
    await expect(order.getByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' })).toBeVisible()

    const dispatch = cardOf(canvas.getByRole('heading', { name: 'ERP dispatch export (CSV)' }))

    await expect(dispatch.getByText('CSV')).toBeVisible()
    await expect(dispatch.getByText('No Mapping reads it yet')).toBeVisible()

    const schema = cardOf(canvas.getByRole('heading', { name: 'ERP article master' }))

    await expect(schema.getByText('Created from a JSON Schema')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /Drop an export from your ERP/ }),
    ).toHaveAttribute('href', '/data-formats/new')
  },
})

export const Search = meta.story({
  async play({ canvas }) {
    await canvas.findByRole('heading', { name: 'ERP purchase order' })
    await userEvent.type(canvas.getByLabelText('Search by name or Mapping'), 'dispatch')

    await expect(canvas.getByRole('heading', { name: 'ERP dispatch export (CSV)' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'ERP purchase order' })).toBeNull()

    await userEvent.type(canvas.getByLabelText('Search by name or Mapping'), ' nothing')

    await expect(canvas.getByText('No data format matches the search.')).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructures: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No data formats yet')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Add a data format' })).toHaveAttribute(
      'href',
      '/data-formats/new',
    )
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructuresState: 'loading' }))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading your data formats')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructuresState: 'error' }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Data formats unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, { documentStructures: createDocumentStructures({ count: 300 }) }),
    )
  },
  // Contrast is checked on the same cards in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('300 data formats')).toBeVisible()
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
    await expect(await canvas.findByRole('heading', { name: 'ERP purchase order' })).toBeVisible()
    await expect(canvas.getAllByText('Noch kein Mapping liest es')[0]).toBeVisible()
    await expect(canvas.getByText('Aus einem JSON Schema erstellt')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'ERP purchase order' })).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('heading', { name: 'ERP purchase order' })).toBeVisible()
      await expect(canvas.queryByRole('link', { name: /Drop an export from your ERP/ })).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...createHandlers(apiUrl, { documentStructures: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText(/Data formats appear here once an Admin adds one\./),
      ).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'Add a data format' })).toBeNull()
    },
  }),
})
