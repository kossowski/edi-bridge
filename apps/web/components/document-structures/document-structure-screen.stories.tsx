import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { DocumentStructureScreen } from '@/components/document-structures/document-structure-screen'
import { toFile } from '@/components/document-structures/document-structure-story-helpers'
import { besideSidebar, darkMode, german, mobile, tablet } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  documentStructureEndpoint,
  type DocumentStructureProblem,
  documentStructuresEndpoint,
  inferDocumentStructureEndpoint,
  toPath,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import {
  createDocumentStructure,
  createHandlers,
  documentStructureOrigins,
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

function refuseUpdate(problem: DocumentStructureProblem, id = order.id) {
  return http.put(updatePath(id), () => HttpResponse.json(problem, { status: 422 }))
}

const ansiExport = toFile({
  ...documentStructureOrigins.windows1252CsvDocument.document,
  fileName: 'lieferscheine-oktober.csv',
})

async function chooseCsvDocument(canvasElement: HTMLElement, label = 'CSV Document') {
  const canvas = within(canvasElement)

  await userEvent.upload(await canvas.findByLabelText(label), ansiExport)
  await canvas.findByRole('region', { name: /lieferscheine-oktober\.csv$/ })
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
    await expect(await canvas.findByRole('group', { name: 'CSV settings' })).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Character encoding' })).toHaveValue(
      'windows-1252',
    )
    await expect(canvas.getByRole('combobox', { name: 'Delimiter' })).toHaveValue(';')
    await expect(
      canvas.getByRole('checkbox', { name: 'The first row names the columns' }),
    ).toBeChecked()
    await expect(await canvas.findByText('Not used yet')).toBeVisible()
  },
})

export const CsvReread = meta.story({
  args: { id: csv!.id },
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)

    const firstRows = await canvas.findByRole('region', {
      name: 'First rows of lieferscheine-oktober.csv',
    })

    await expect(within(firstRows).getAllByText('Lübeck').length).toBeGreaterThan(0)
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'The first row names the columns' }))
    await expect(await canvas.findByRole('columnheader', { name: 'column1' })).toBeVisible()
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getByText('2 unsaved changes')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(await canvas.findByText('The Document Structure is saved.')).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'The first row names the columns' }),
    ).not.toBeChecked()
  },
})

export const CsvRereadUnreadable = meta.story({
  args: { id: csv!.id },
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)
    await canvas.findByRole('treegrid')
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Character encoding' }),
      'utf-8',
    )
    await expect(
      await canvas.findByText(/^The file cannot be read with its character encoding/),
    ).toBeVisible()
    await expect(canvas.getAllByText(/L\uFFFDbeck/).length).toBeGreaterThan(0)
    await expect(canvas.queryByRole('treegrid')).toBeNull()
    await expect(canvas.getByLabelText('CSV Document')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(
      canvas.getByText(
        'Adjust the CSV settings, fix the problem in the file, or choose another one.',
      ),
    ).toBeVisible()

    const save = canvas.getByRole('button', { name: 'Save' })

    await expect(save).toBeDisabled()
    await expect(save).toHaveAccessibleDescription(
      'Saving needs a CSV Document EDI Bridge can read with these settings.',
    )
    await expect(canvas.getAllByRole('alert')).toHaveLength(1)
  },
})

export const CsvRereading = meta.story({
  args: { id: csv!.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${inferDocumentStructureEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)
    await expect(await canvas.findByText('Reading the CSV Document…')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled()
  },
})

const csvDocumentNeeded = 'Choose a CSV Document to read it again with the new settings.'

export const CsvDocumentRequired = meta.story({
  args: { id: csv!.id },
  async play({ canvas, canvasElement }) {
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'The first row names the columns' }),
    )
    await expect(canvas.getByText('1 unsaved change')).toBeVisible()

    const save = canvas.getByRole('button', { name: 'Save' })

    await expect(save).toBeDisabled()
    await expect(save).toHaveAccessibleDescription(csvDocumentNeeded)
    await chooseCsvDocument(canvasElement)
    await canvas.findByRole('treegrid')
    await expect(save).toBeEnabled()
    await expect(canvas.queryByText(csvDocumentNeeded)).toBeNull()
  },
})

export const MobileCsvDocumentRequired = meta.story({
  ...mobile,
  args: { id: csv!.id },
  async play({ canvas }) {
    await userEvent.selectOptions(await canvas.findByRole('combobox', { name: 'Delimiter' }), ',')

    const hint = canvas.getByText(csvDocumentNeeded)
    const { bottom } = hint.getBoundingClientRect()

    await expect(hint).toBeVisible()
    await expect(bottom).toBeLessThanOrEqual(window.innerHeight)
  },
})

const csvUsedByPublishedVersions = refuseUpdate(
  {
    code: 'usedByMappingVersion',
    message:
      'Published Mapping Versions read this Document Structure with its CSV settings: ERP dispatch to DESADV v1',
    path: null,
    line: null,
    mappingVersions: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        mappingId: orderMapping.id,
        mappingName: 'ERP dispatch to DESADV',
        version: 1,
        publishedAt: '2026-09-01T08:00:00.000Z',
      },
    ],
  },
  csv!.id,
)

export const CsvUsedByMappingVersion = meta.story({
  args: { id: csv!.id },
  beforeEach({ msw }) {
    msw.use(csvUsedByPublishedVersions)
  },
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)
    await canvas.findByRole('treegrid')
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Delimiter' }), '|')
    await canvas.findByRole('treegrid')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(
      await canvas.findByText(/^Published Mapping Versions read CSV Documents with these settings/),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: 'ERP dispatch to DESADV, version 1' }),
    ).toBeVisible()
  },
})

export const CsvLinkedByMapping = meta.story({
  args: { id: csv!.id },
  beforeEach({ msw }) {
    msw.use(
      refuseUpdate(
        {
          code: 'linkedByMapping',
          message:
            'A Mapping Draft links rows[].Bemerkung, which the change at rows[].Bemerkung would remove',
          path: 'rows[].Bemerkung',
          line: null,
          mappingVersions: null,
        },
        csv!.id,
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)
    await canvas.findByRole('treegrid')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'The first row names the columns' }))
    await canvas.findByRole('treegrid')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(
      await canvas.findByText(/^A Mapping Draft links a field this change would remove/),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /in the tree$/ })).toBeNull()
  },
})

export const TabletCsvReread = meta.story({
  ...tablet,
  args: { id: csv!.id },
  decorators: [besideSidebar, german],
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement, 'CSV-Document')
    await expect(
      await canvas.findByRole('region', { name: 'Erste Zeilen von lieferscheine-oktober.csv' }),
    ).toBeVisible()
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expectReadableColumns(canvasElement)
  },
})

export const DarkCsvReread = meta.story({
  args: { id: csv!.id },
  beforeEach: darkMode,
  async play({ canvas, canvasElement }) {
    await chooseCsvDocument(canvasElement)
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
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

    return darkMode()
  },
  async play({ canvas, canvasElement }) {
    await changeAndSave(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
})
