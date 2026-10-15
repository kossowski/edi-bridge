import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DocumentStructureScreen } from '@/components/document-structures/document-structure-screen'
import { toFile } from '@/components/document-structures/document-structure-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import {
  besideSidebar,
  darkMode,
  expectNoPageScroll,
  german,
  mobile,
  tablet,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  documentStructureEndpoint,
  documentStructureOrigins,
  type DocumentStructureProblem,
  documentStructuresEndpoint,
  inferDocumentStructureEndpoint,
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

const [csv, fromJsonSchema] = seedUnusedDocumentStructures

const invoiceExport = seedDocumentStructures.find(
  ({ name }) => name === 'ERP invoice export (CSV)',
)!

const large = createDocumentStructure({ fieldCount: 400 })

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

async function openTechnicalSettings(canvasElement: HTMLElement, name = 'Technical settings') {
  const canvas = within(canvasElement)
  const trigger = await canvas.findByRole('button', { name })

  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(trigger)
  }
}

async function chooseCsvDocument(
  canvasElement: HTMLElement,
  label = 'CSV Document',
  settings = 'Technical settings',
) {
  const canvas = within(canvasElement)

  await openTechnicalSettings(canvasElement, settings)

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

const english = {
  settings: 'Technical settings',
  required: 'buyer.contact.phone is required',
  save: 'Save',
}

async function changeAndSave(canvasElement: HTMLElement, labels = english) {
  const canvas = within(canvasElement)

  await openTechnicalSettings(canvasElement, labels.settings)

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

function fieldButton(canvasElement: HTMLElement, label: string) {
  const escaped = label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return within(canvasElement).findByRole('button', { name: new RegExp(`^${escaped}`) })
}

async function selectField(canvasElement: HTMLElement, label: string) {
  const field = await fieldButton(canvasElement, label)

  if (field.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(field)
  }

  await expect(field).toHaveAttribute('aria-expanded', 'true')

  return field
}

function pressedValues(canvasElement: HTMLElement) {
  return [...canvasElement.querySelectorAll('[data-sample-value][aria-pressed=true]')]
}

// The Mapping link waits for the list request, whose mock handler adds a random delay; the detail
// has none. On a busy CI runner the cold first story needs more than the default second.
const firstRender = { timeout: 5000 }

export const Default = meta.story({
  async play({ canvas, canvasElement }) {
    const values = await canvas.findByRole(
      'group',
      { name: 'Values in order-4711.json' },
      firstRender,
    )

    await expect(canvasElement.querySelector('li [aria-expanded=true]')).toBe(
      canvasElement.querySelector('li [data-path]'),
    )

    const [mapping] = await canvas.findAllByRole(
      'link',
      { name: 'Hansemarkt: ORDERS to ERP JSON' },
      firstRender,
    )

    await expect(mapping).toBeVisible()
    await selectField(canvasElement, 'Order number')

    const [pressed] = pressedValues(canvasElement)

    await expect(pressed).toHaveAttribute('data-path', 'orderNumber')
    await expect(canvas.getByText('Why this name')).toBeVisible()

    const gtin = values.querySelector<HTMLElement>('[data-path="lines[].gtin"]')!

    await userEvent.click(gtin)
    await expect(await fieldButton(canvasElement, 'Article number (GTIN)')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(pressedValues(canvasElement).length).toBe(2)
  },
})

export const KeyboardValues = meta.story({
  async play({ canvas }) {
    const values = await canvas.findByRole('group', { name: 'Values in order-4711.json' })
    const [first, second] = within(values).getAllByRole('button')

    await expect(first).toHaveAttribute('tabindex', '0')
    await expect(second).toHaveAttribute('tabindex', '-1')
    first!.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(second).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(second).toHaveAttribute('aria-pressed', 'true')
  },
})

export const InvoiceExport = meta.story({
  args: { id: invoiceExport.id },
  async play({ canvas, canvasElement }) {
    const rows = await canvas.findByRole('table', {
      name: 'Rows of Rechnungsexport_2026-10-08.csv',
    })

    await expect(within(rows).getByRole('columnheader', { name: /Unit price/ })).toBeVisible()
    await expect(canvas.getAllByText('Unsure')).toHaveLength(2)
    await expect(await fieldButton(canvasElement, 'Rows')).toHaveAttribute('aria-expanded', 'true')
    await expect(pressedValues(canvasElement)).toHaveLength(
      within(rows).getAllByRole('button').length,
    )

    const [price] = within(rows).getAllByRole('button', { name: /, Unit price$/ })

    await userEvent.click(price!)
    await expect(await fieldButton(canvasElement, 'Unit price')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(
      canvas.getByText('EDI Bridge is not sure about this name.', { exact: false }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Keep this name' })).toBeVisible()
  },
})

export const RenameField = meta.story({
  args: { id: invoiceExport.id },
  async play({ canvas, canvasElement }) {
    await selectField(canvasElement, 'Unit price')

    const name = canvas.getByRole('textbox', { name: 'Name shown in Mappings' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Price per unit')
    await userEvent.click(canvas.getByRole('button', { name: 'Rename' }))
    await expect(await canvas.findByText('Renamed to “Price per unit”.')).toBeVisible()
    await expect(name).toHaveFocus()
    await expect(await fieldButton(canvasElement, 'Price per unit')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText('Named by you')).toBeVisible()
    await expect(canvas.getAllByText('Unsure')).toHaveLength(1)
  },
})

export const KeepName = meta.story({
  args: { id: invoiceExport.id },
  async play({ canvas, canvasElement }) {
    await selectField(canvasElement, 'Unit price')
    await userEvent.click(canvas.getByRole('button', { name: 'Keep this name' }))
    await expect(await canvas.findByText('Kept the name “Unit price”.')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Name shown in Mappings' })).toHaveFocus()
    await expect(canvas.queryByRole('button', { name: 'Keep this name' })).toBeNull()
    await expect(canvas.getAllByText('Unsure')).toHaveLength(1)
  },
})

export const RenameRefused = meta.story({
  args: { id: invoiceExport.id },
  beforeEach({ msw }) {
    msw.use(
      refuseUpdate(
        {
          code: 'unknownPath',
          message: 'There is no node at rows[].EPreis',
          path: 'rows[].EPreis',
          line: null,
          mappingVersions: null,
        },
        invoiceExport.id,
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await selectField(canvasElement, 'Unit price')
    await userEvent.click(canvas.getByRole('button', { name: 'Keep this name' }))

    const alert = await canvas.findByRole('alert')

    await expect(alert).toHaveTextContent('The data format has changed in the meantime.')
    await expect(alert.parentElement).toHaveFocus()
  },
})

export const FromJsonSchema = meta.story({
  args: { id: fromJsonSchema!.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('Created from a JSON Schema')).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 2, name: 'Fields' })).toBeVisible()
    await expect(canvas.queryByRole('group', { name: /^Values in / })).toBeNull()
  },
})

export const Csv = meta.story({
  args: { id: csv!.id },
  async play({ canvas, canvasElement }) {
    await openTechnicalSettings(canvasElement)
    await expect(await canvas.findByRole('group', { name: 'CSV settings' })).toBeVisible()
    await expect(canvas.getByRole('combobox', { name: 'Character encoding' })).toHaveValue(
      'windows-1252',
    )
    await expect(canvas.getByRole('combobox', { name: 'Delimiter' })).toHaveValue(';')
    await expect(
      canvas.getByRole('checkbox', { name: 'The first row names the columns' }),
    ).toBeChecked()
    await expect((await canvas.findAllByText('Not used yet'))[0]).toBeVisible()
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
    await expect(await canvas.findByText('The data format is saved.')).toBeVisible()
    await expect(
      canvas.getByRole('checkbox', { name: 'The first row names the columns' }),
    ).not.toBeChecked()
    await expect(
      await canvas.findByRole('table', { name: 'Rows of lieferscheine-oktober.csv' }),
    ).toBeVisible()
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
    await openTechnicalSettings(canvasElement)
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
  async play({ canvas, canvasElement }) {
    await openTechnicalSettings(canvasElement)
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
            'A Draft links rows[].Bemerkung, which the change at rows[].Bemerkung would remove',
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
    await chooseCsvDocument(canvasElement, 'CSV-Document', 'Technische Einstellungen')
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
  async play({ canvas, canvasElement }) {
    await openTechnicalSettings(canvasElement)
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
      settings: 'Technische Einstellungen',
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
    await openTechnicalSettings(canvasElement)
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expectReadableColumns(canvasElement)
  },
})

export const KeyboardToggle = meta.story({
  async play({ canvas, canvasElement }) {
    await openTechnicalSettings(canvasElement)
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
          'A Draft links buyer.contact.phone, which the change at buyer.contact.phone would remove',
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
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('group', { name: /^Values in / })).toBeVisible()
    await openTechnicalSettings(canvasElement)
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
  async play({ canvas, canvasElement }) {
    await openTechnicalSettings(canvasElement)
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getAllByText('Loading Mappings')[0]!.closest('[aria-busy]')).not.toBeNull()
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
    await expect(canvas.getByText('Loading data format')).toBeInTheDocument()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Data format not found')).toBeVisible()
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
    await expect(await canvas.findByText('Data format unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: invoiceExport.id },
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('group', { name: 'Werte in Rechnungsexport_2026-10-08.csv' }),
    ).toBeVisible()
    await expect(canvas.getAllByText('Unsicher')).toHaveLength(2)
    await selectField(canvasElement, 'Unit price')
    await expect(canvas.getByRole('button', { name: 'Namen behalten' })).toBeVisible()
    await openTechnicalSettings(canvasElement, 'Technische Einstellungen')
    await expect(
      await canvas.findByRole('treegrid', { name: 'Felder von ERP invoice export (CSV)' }),
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

async function expectNothingToChange(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)

  await expect(canvas.queryAllByRole('textbox')).toHaveLength(0)
  await expect(canvas.queryAllByRole('combobox')).toHaveLength(0)
  await expect(canvas.queryAllByRole('checkbox')).toHaveLength(0)
  await expect(canvasElement.querySelector('input[type=file]')).toBeNull()
  await expect(canvasElement.querySelector('form')).toBeNull()
}

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await selectField(canvasElement, 'Order number')
      await expect(canvas.getByText('Why this name')).toBeVisible()
      await openTechnicalSettings(canvasElement)
      await expect(
        await canvas.findByRole('treegrid', { name: 'Fields of ERP purchase order' }),
      ).toBeVisible()
      await expect(
        canvas.getByRole('heading', { level: 1, name: 'ERP purchase order' }),
      ).toBeInTheDocument()
      await expectNothingToChange(canvasElement)
      await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Discard changes' })).toBeNull()
      await expect(canvas.queryByText('No unsaved changes')).toBeNull()
      await expect(
        canvas.getByText('Use the arrow keys to move between rows and to open or close objects.'),
      ).toBeVisible()

      const [first, second] = canvas.getAllByRole('row').slice(1)
      first!.focus()
      await userEvent.keyboard('{ArrowDown}')
      await expect(second).toHaveFocus()
    },
  }),
})

export const ViewerCsv = meta.story({
  args: { id: csv!.id },
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await openTechnicalSettings(canvasElement)
      const settings = await canvas.findByRole('region', { name: 'CSV settings' })
      await expect(within(settings).getByText('Semicolon (;)')).toBeVisible()
      await expect(within(settings).getByText('Windows-1252')).toBeVisible()
      await expect(within(settings).getByText('The first row names the columns')).toBeVisible()
      await expect(await canvas.findByRole('treegrid')).toBeVisible()
      await expect((await canvas.findAllByText('Not used yet'))[0]).toBeVisible()
      await expectNothingToChange(canvasElement)
      await expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull()
    },
  }),
})

export const ViewerGerman = meta.story({
  args: { id: csv!.id },
  ...viewerStory({
    decorators: [german],
    async play({ canvas, canvasElement }) {
      await openTechnicalSettings(canvasElement, 'Technische Einstellungen')
      const settings = await canvas.findByRole('region', { name: 'CSV-Einstellungen' })
      await expect(within(settings).getByText('Semikolon (;)')).toBeVisible()
      await expect(within(settings).getByText('Kopfzeile')).toBeVisible()
      await expect(await canvas.findByRole('treegrid', { name: /^Felder von / })).toBeVisible()
      await expectNothingToChange(canvasElement)
      await expect(canvas.queryByRole('button', { name: 'Speichern' })).toBeNull()
    },
  }),
})

export const ViewerDark = meta.story({
  ...viewerStory({
    beforeEach: darkMode,
    async play({ canvas, canvasElement }) {
      await selectField(canvasElement, 'Order number')
      await openTechnicalSettings(canvasElement)
      await expect(await canvas.findByRole('treegrid')).toBeVisible()
      await expectNothingToChange(canvasElement)
    },
  }),
})

export const Mobile = meta.story({
  ...mobile,
  args: { id: invoiceExport.id },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('table', { name: 'Rows of Rechnungsexport_2026-10-08.csv' })
    await selectField(canvasElement, 'Unit price')
    await expectNoPageScroll(canvasElement)
  },
})

export const MobileJson = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('group', { name: 'Values in order-4711.json' })
    await selectField(canvasElement, 'Order number')
    await openTechnicalSettings(canvasElement)
    await waitFor(() => expectNoPageScroll(canvasElement))
  },
})

export const DarkInvoiceExport = meta.story({
  args: { id: invoiceExport.id },
  beforeEach: darkMode,
  async play({ canvas }) {
    const rows = await canvas.findByRole('table', {
      name: 'Rows of Rechnungsexport_2026-10-08.csv',
    })

    const [price] = within(rows).getAllByRole('button', { name: /, Unit price$/ })

    await userEvent.click(price!)
    await expect(price).toHaveAttribute('aria-pressed', 'true')
  },
})
