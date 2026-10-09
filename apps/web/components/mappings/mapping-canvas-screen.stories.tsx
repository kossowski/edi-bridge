import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { documentStructureEndpoint, mappingDraftEndpoint } from '@edi-bridge/contracts'
import {
  createDocumentStructure,
  createHandlers,
  createMappingDrafts,
  seedMappingDrafts,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedMappingDrafts.find((draft) => draft.name === name && draft.latestVersion !== null)!
}

const inbound = seeded('Hansemarkt: ORDERS to ERP JSON')

const outbound = seeded('Hansemarkt: ERP JSON to DESADV')

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const largeStructure = createDocumentStructure({ fieldCount: 400 })

const [, , largeDraft] = createMappingDrafts({ count: 3, documentStructures: [largeStructure] })

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen',
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

export const Outbound = meta.story({
  args: { id: outbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ERP JSON to DESADV' }),
    ).toBeVisible()
    await expect(canvas.getByText('Outbound: Document Structure to Message Type')).toBeVisible()
    await expect(canvas.getByText('18 links')).toBeVisible()
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()
    await expect(canvas.getByText('UNH')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from despatchNumber to BGM/1004' }),
    ).toBeInTheDocument()
  },
})

export const Inbound = meta.story({
  args: { id: inbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
    await expect(canvas.getByText('Inbound: Message Type to Document Structure')).toBeVisible()
    await expect(await canvas.findByText('orderNumber')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()
  },
})

export const CollapseParts = meta.story({
  args: { id: inbound.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Collapse UNH' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse BGM' }))
    await expect(canvas.getByRole('button', { name: 'Expand BGM' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(await canvas.findByText('DTM+137')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Link from BGM/1004 to orderNumber' }),
    ).toBeInTheDocument()
  },
})

export const EmptyDraft = meta.story({
  args: { id: withoutLinks.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('No links yet')).toBeVisible()
    await expect(await canvas.findByText('invoiceNumber')).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow__edge')).toBeNull()
  },
})

export const LargeVolume = meta.story({
  args: { id: largeDraft!.id },
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: [largeDraft!],
        documentStructures: [largeStructure],
      }),
    )
  },
  // Contrast is checked on the same nodes in the small stories; see the Mappings list.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(largeStructure.name, { exact: false })).toBeVisible()

    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0),
    )

    // Only the parts in view are rendered, not all of the Document Structure and the Message Type.
    await expect(canvasElement.querySelectorAll('.react-flow__node').length).toBeLessThan(200)
  },
})

export const Loading = meta.story({
  args: { id: inbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingDraftEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Mapping')).toBeInTheDocument()
  },
})

export const LoadingStructures = meta.story({
  args: { id: outbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the structures')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: inbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingDraftEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping unavailable')).toBeVisible()
  },
})

export const StructuresUnavailable = meta.story({
  args: { id: outbound.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructureEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Structures unavailable')).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping not found')).toBeVisible()
  },
})

export const SmallScreen = meta.story({
  args: { id: inbound.id },
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await expect(canvasElement.querySelector('.react-flow')).toBeNull()
  },
})

export const German = meta.story({
  args: { id: inbound.id },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(
      await canvas.findByText('Eingehend: Message Type zu Document Structure'),
    ).toBeVisible()
    await expect(await canvas.findByText('Nachrichtenkopf')).toBeVisible()
    await expect(
      await canvas.findByRole('img', { name: 'Verknüpfung von BGM/1004 zu orderNumber' }),
    ).toBeInTheDocument()
  },
})

export const Dark = meta.story({
  args: { id: outbound.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('despatchNumber')).toBeVisible()
  },
})
