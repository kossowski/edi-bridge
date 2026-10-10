import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { DocumentStructureScreen } from '@/components/document-structures/document-structure-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  documentStructureEndpoint,
  type DocumentStructureProblem,
  documentStructuresEndpoint,
  toPath,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import {
  createDocumentStructure,
  createHandlers,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedMappingDrafts,
  seedUnusedDocumentStructures,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const order = seedDocumentStructureOf.ORDERS

const [csv] = seedUnusedDocumentStructures

const large = createDocumentStructure({ fieldCount: 2000 })

const orderMapping = seedMappingDrafts.find(
  ({ name }) => name === 'Hansemarkt: ORDERS to ERP JSON',
)!

const detailPath = (id: string) => `${apiUrl}${toPath(documentStructureEndpoint.path, { id })}`

const updatePath = (id: string) =>
  `${apiUrl}${toPath(updateDocumentStructureEndpoint.path, { id })}`

function refuseUpdate(problem: DocumentStructureProblem) {
  return http.put(updatePath(order.id), () => HttpResponse.json(problem, { status: 422 }))
}

const refusedByPublishedVersions = refuseUpdate({
  code: 'usedByMappingVersion',
  message:
    'Published Mapping Versions use buyer.contact.phone, and a published Mapping Version never changes: Hansemarkt: ORDERS to ERP JSON v2, Hansemarkt: ORDERS to ERP JSON v3',
  path: 'buyer.contact.phone',
  line: null,
  mappingVersions: [2, 3].map((version) => ({
    id: `00000000-0000-4000-8000-00000000000${version}`,
    mappingId: orderMapping.id,
    mappingName: orderMapping.name,
    version,
    publishedAt: `2026-09-0${version}T08:00:00.000Z`,
  })),
})

const german = (Story: () => ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

// At 768px the app's sidebar takes 16rem of the width.
const besideSidebar = (Story: () => ReactNode) => (
  <div className="ml-64">
    <Story />
  </div>
)

const tablet = {
  parameters: {
    viewport: {
      options: { tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } } },
    },
  },
  globals: { viewport: { value: 'tablet', isRotated: false } },
}

async function expectReadableColumns(canvasElement: HTMLElement) {
  const [field, ...headers] = canvasElement.querySelectorAll('[role=treegrid] th')
  const scroller = canvasElement.querySelector('[data-slot=table-container]')!

  await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)

  await expect(field!.getBoundingClientRect().width).toBeGreaterThanOrEqual(160)

  for (const header of [field!, ...headers]) {
    await expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
  }

  for (const select of canvasElement.querySelectorAll('[role=treegrid] select')) {
    await expect(select.getBoundingClientRect().width).toBeGreaterThanOrEqual(112)
  }
}

const english = { required: 'buyer.contact.phone is required', save: 'Save' }

async function changeAndSave(canvasElement: HTMLElement, labels = english) {
  const canvas = within(canvasElement)

  await userEvent.click(await canvas.findByRole('checkbox', { name: labels.required }))
  await userEvent.click(canvas.getByRole('button', { name: labels.save }))
}

const meta = preview.meta({
  title: 'Document Structures/DocumentStructureScreen',
  component: DocumentStructureScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: order.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('treegrid', { name: 'Fields of ERP purchase order' }),
    ).toBeVisible()
    await expect(
      await canvas.findByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
    await expect(canvas.getByText('No unsaved changes')).toBeVisible()
  },
})

export const Csv = meta.story({
  args: { id: csv!.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'CSV settings' })).toBeVisible()
    await expect(canvas.getByText('Windows-1252')).toBeVisible()
    await expect(await canvas.findByText('Not used yet')).toBeVisible()
  },
})

export const UnsavedChanges = meta.story({
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'buyer.contact.phone is required' }),
    )
    await userEvent.click(canvas.getByRole('checkbox', { name: 'buyer repeats' }))
    await expect(canvas.getByText('2 unsaved changes')).toBeVisible()
  },
})

export const RefusedByPublishedVersions = meta.story({
  beforeEach({ msw }) {
    msw.use(refusedByPublishedVersions)
  },
  async play({ canvas, canvasElement }) {
    await changeAndSave(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert.parentElement).toHaveFocus()
    await expect(
      canvas.getByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON, version 3' }),
    ).toBeVisible()
    await expect(within(alert).queryByText(/^Details/)).toBeNull()
    await expect(canvas.getByText('Used by published Mapping Versions')).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Show buyer.contact.phone in the tree' }),
    )
    await expect(canvasElement.querySelector('tr[data-path="buyer.contact.phone"]')).toHaveFocus()
  },
})

export const TabletRefused = meta.story({
  ...tablet,
  decorators: [besideSidebar, german],
  beforeEach({ msw }) {
    msw.use(refusedByPublishedVersions)
  },
  async play({ canvas, canvasElement }) {
    await changeAndSave(canvasElement, {
      required: 'buyer.contact.phone ist Pflicht',
      save: 'Speichern',
    })
    await expect(await canvas.findByRole('alert')).toBeVisible()
    await expect(canvas.getByText('Von veröffentlichten Mapping Versions verwendet')).toBeVisible()
    await expectReadableColumns(canvasElement)
  },
})

export const Tablet = meta.story({
  ...tablet,
  decorators: [besideSidebar],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expectReadableColumns(canvasElement)
  },
})

export const KeyboardToggle = meta.story({
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('treegrid')
    const buyer = canvasElement.querySelector<HTMLElement>('tr[data-path="buyer"]')!
    buyer.focus()
    await expect(buyer).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(buyer).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard(' ')
    await expect(buyer).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse buyer' }))
    await expect(buyer).toHaveAttribute('aria-expanded', 'false')
  },
})

export const RefusedByDraftLink = meta.story({
  beforeEach({ msw }) {
    msw.use(
      refuseUpdate({
        code: 'linkedByMapping',
        message:
          'A Mapping Draft links buyer.contact.phone, which the change at buyer.contact.phone would remove',
        path: 'buyer.contact.phone',
        line: null,
        mappingVersions: null,
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await changeAndSave(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeVisible()
    await expect(canvas.getByText('Linked by a Mapping Draft')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: large.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructures: [...seedDocumentStructures, large] }))
  },
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
  },
})

export const MappingsLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${documentStructuresEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getByText('Loading Mappings').closest('[aria-busy]')).not.toBeNull()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(detailPath(order.id), async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Document Structure')).toBeInTheDocument()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document Structure not found')).toBeVisible()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(detailPath(order.id), () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document Structure unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('treegrid', { name: 'Felder von ERP purchase order' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(refusedByPublishedVersions)
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas, canvasElement }) {
    await changeAndSave(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
})
