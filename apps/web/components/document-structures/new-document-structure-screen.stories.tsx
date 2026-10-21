import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { toFile } from '@/components/document-structures/document-structure-story-helpers'
import { NewDocumentStructureScreen } from '@/components/document-structures/new-document-structure-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createDocumentStructureEndpoint,
  csvRowsName,
  csvRowsPath,
  defaultCsvSettings,
  type DocumentField,
  type DocumentStructureInference,
  documentStructureOrigins,
  type FieldLabelChoice,
  inferDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import { createHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const invoiceExport = toFile(documentStructureOrigins.invoiceCsvDocument.document)

const dropLabel = /^Drop an export from your ERP/

const reviewTitle = 'Fields read from Rechnungsexport_2026-10-08.csv'

const readingTitle = 'Reading Rechnungsexport_2026-10-08.csv'

const createPath = `${apiUrl}${createDocumentStructureEndpoint.path}`

const inferencePath = `${apiUrl}${inferDocumentStructureEndpoint.path}`

const wideColumns = Array.from(
  { length: 200 },
  (_, index) => `Merkmal${String(index + 1).padStart(3, '0')}`,
)

const wideText = [
  wideColumns.join(';'),
  ...Array.from({ length: 3 }, (_, row) =>
    wideColumns.map((_, column) => `W${row + 1}-${column + 1}`).join(';'),
  ),
].join('\r\n')

const wideExport = new File([wideText], 'artikelstamm-breit.csv')

function wideField(name: string, index: number): DocumentField {
  const unsure = index % 50 === 7

  return {
    kind: 'field',
    path: `${csvRowsPath}.${name}`,
    name,
    label: `Attribute ${index + 1}`,
    labelReason: unsure
      ? `No known name matches "${name}". Check that this is what it holds.`
      : `"${name}" is attribute ${index + 1} of the article master data.`,
    labelUnsure: unsure,
    type: 'string',
    required: true,
  }
}

const wideRows = {
  path: csvRowsPath,
  name: csvRowsName,
  label: 'Rows',
  labelReason: 'Each line of the file.',
  labelUnsure: false,
  required: true,
} as const

const wideInferred: DocumentStructureInference = {
  format: 'csv',
  csv: defaultCsvSettings,
  facts: { columnCount: wideColumns.length, rowCount: 3 },
  sample: { fileName: wideExport.name, text: wideText, takenAt: '2026-10-12T08:00:00.000Z' },
  children: [
    {
      ...wideRows,
      kind: 'array',
      items: { ...wideRows, kind: 'object', children: wideColumns.map(wideField) },
    },
  ],
  fieldNamesNotice: null,
}

async function drop(canvasElement: HTMLElement, file: File, label = dropLabel) {
  await userEvent.upload(within(canvasElement).getByLabelText(label), file)
}

async function review(canvasElement: HTMLElement, title = reviewTitle) {
  return within(canvasElement).findByRole('heading', { name: title }, { timeout: 5000 })
}

async function confirmEveryName(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)

  for (const confirm of canvas.queryAllByRole('button', { name: /^Yes, “.+” is right$/ })) {
    await userEvent.click(confirm)
  }
}

async function openTechnicalOptions(canvasElement: HTMLElement, name = 'Technical options') {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
}

const meta = preview.meta({
  title: 'Document Structures/NewDocumentStructureScreen',
  component: NewDocumentStructureScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Drop = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'New data format' }),
    ).toBeInTheDocument()
    await expect(canvas.getByLabelText(dropLabel)).toHaveAttribute('type', 'file')
    await expect(canvas.getByRole('button', { name: 'Technical options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
})

export const Reading = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureInferenceState: 'loading' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await expect(await canvas.findByRole('heading', { name: readingTitle })).toBeVisible()
    // The heading shows while the file opens; the columns follow once it is read.
    await expect(await canvas.findByText('Found 12 columns, separated by semicolons')).toBeVisible()
    const steps = [...canvas.getAllByRole('list')[0]!.children]

    await expect(steps[0]).toHaveTextContent('Opening the file: done')
    await expect(steps[1]).toHaveTextContent('Finding the columns: done')
    await expect(steps[1]).toHaveTextContent('Found 12 columns, separated by semicolons')
    await expect(steps[1]).toHaveTextContent('3 rows read')
    await expect(steps[2]).toHaveTextContent('Naming the fields in plain words: in progress')
    await expect(steps[2]).toHaveAttribute('aria-current', 'step')
  },
})

export const ReadFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureInferenceState: 'error' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await expect(await canvas.findByText('The file could not be read. Try again.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Use another file' }))
    await expect(canvas.getByLabelText(dropLabel)).toHaveFocus()
  },
})

export const UnreadableFile = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, toFile(documentStructureOrigins.invalidJsonDocument.document))
    await expect(await canvas.findByText('The file is not valid JSON.')).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'broken.json could not be read' }),
    ).toBeVisible()
  },
})

export const EmptyFile = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, new File([], 'export.csv'))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('The file is empty.')
  },
})

export const ReviewWithUnsureNames = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await expect(await review(canvasElement)).toHaveFocus()
    await expect(canvas.getByText('12 fields found')).toBeVisible()
    await expect(canvas.getByText('2 names to check')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Yes, “Unit price” is right' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Check 2 names first' })).toBeDisabled()
    await expect(canvas.getByRole('textbox', { name: 'Name of this data format' })).toHaveValue(
      'Rechnungsexport 2026 10 08',
    )
    await expect(canvas.queryByText('Fields named without AI')).toBeNull()
  },
})

export const FieldNamesWithoutAiBudget = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureFieldNamesNotice: 'aiBudgetExhausted' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    const notice = within(await canvas.findByRole('status', { name: 'Fields named without AI' }))

    await expect(
      notice.getByText(
        "Today's AI budget is used up, so the field names come from the file. Check them and change any name below.",
      ),
    ).toBeVisible()
    await expect(canvas.getByText('2 names to check')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit” is right' }))
    await expect(canvas.getByText('1 name to check')).toBeVisible()
  },
})

export const FieldNamesWithoutAiUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureFieldNamesNotice: 'aiUnavailable' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)

    await expect(
      await canvas.findByText(
        'The AI could not name the fields, so the field names come from the file. Check them and change any name below.',
      ),
    ).toBeVisible()
  },
})

export const AllConfirmed = meta.story({
  async play({ canvas, canvasElement, msw }) {
    let labels: FieldLabelChoice[] | undefined

    msw.use(
      http.post(createPath, async ({ request }) => {
        labels = createDocumentStructureEndpoint.body.parse(await request.clone().json()).labels
      }),
    )
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit” is right' }))
    await expect(canvas.getByRole('button', { name: 'Yes, “Unit price” is right' })).toHaveFocus()
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Or type a better name for EPreis' }),
      'Price per unit',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Use this name' }))
    await expect(canvas.getByText('All names checked')).toBeVisible()
    const save = canvas.getByRole('button', { name: 'Save data format' })

    await expect(save).toHaveFocus()
    await userEvent.click(save)
    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/data-formats\/[\da-f-]{36}$/),
      ),
    )
    await expect(labels?.map(({ path }) => path)).toEqual([
      'rows[]',
      'rows[].RechNr',
      'rows[].RechDatum',
      'rows[].AuftrNr',
      'rows[].KdNr',
      'rows[].ArtNr',
      'rows[].Bezeichnung',
      'rows[].Menge',
      'rows[].ME',
      'rows[].EPreis',
      'rows[].Netto',
      'rows[].MwSt',
      'rows[].Whg',
    ])
    await expect(labels).toContainEqual({
      path: 'rows[].RechNr',
      label: 'Invoice number',
      labelReason: '"RechNr" stands for "Rechnungsnummer", the number of the invoice.',
    })
    await expect(labels).toContainEqual({
      path: 'rows[].ME',
      label: 'Unit',
      labelReason:
        '"ME" stands for "Mengeneinheit", the unit the quantity is counted in, if the values are units. Values KRT and ST look like units.',
    })
    await expect(labels).toContainEqual({
      path: 'rows[].EPreis',
      label: 'Price per unit',
      labelReason: null,
    })
  },
})

export const AllConfirmedWithoutAi = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureFieldNamesNotice: 'aiBudgetExhausted' }))
  },
  async play({ canvas, canvasElement, msw }) {
    let labels: FieldLabelChoice[] | undefined

    msw.use(
      http.post(createPath, async ({ request }) => {
        labels = createDocumentStructureEndpoint.body.parse(await request.clone().json()).labels
      }),
    )
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await confirmEveryName(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Save data format' }))
    await waitFor(() => expect(getRouter().push).toHaveBeenCalled())
    await expect(labels).toEqual([
      { path: 'rows[].ME', label: 'Unit' },
      { path: 'rows[].EPreis', label: 'Unit price' },
    ])
  },
})

export const NameMissing = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit” is right' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit price” is right' }))
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Name of this data format' }))
    await expect(canvas.getByRole('button', { name: 'Name the data format first' })).toBeDisabled()
  },
})

export const SaveFailed = meta.story({
  async play({ canvas, canvasElement, msw }) {
    msw.use(
      http.post(createPath, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
    await drop(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await review(canvasElement, 'Fields read from order.json')
    await confirmEveryName(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Save data format' }))
    const alert = await canvas.findByText('The data format could not be saved. Try again.')

    await expect(alert.parentElement).toHaveFocus()
  },
})

export const FromJsonSchema = meta.story({
  async play({ canvas, canvasElement }) {
    await openTechnicalOptions(canvasElement)
    await drop(
      canvasElement,
      toFile(documentStructureOrigins.jsonSchema.jsonSchema),
      /^JSON Schema/,
    )
    await review(canvasElement, 'Fields read from the JSON Schema')
    await expect(canvas.getByRole('textbox', { name: 'Name of this data format' })).toHaveValue(
      'article',
    )
  },
})

export const CsvSettings = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, toFile(documentStructureOrigins.windows1252CsvDocument.document))
    await expect(
      await canvas.findByText(/^The file cannot be read with its character encoding/),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Change the CSV settings' }))
    const delimiter = canvas.getByRole('combobox', { name: 'Delimiter' })

    await expect(delimiter).toHaveFocus()
    await expect(canvas.queryByRole('button', { name: 'Change the CSV settings' })).toBeNull()
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Character encoding' }),
      'windows-1252',
    )
    await review(canvasElement, 'Fields read from lieferscheine-ansi.csv')
    const values = canvas.getByRole('group', { name: /lieferscheine-ansi\.csv/ })

    await expect(within(values).getAllByText('Lübeck').length).toBeGreaterThan(0)
  },
})

export const CsvSettingsKeepChoices = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit” is right' }))
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Or type a better name for EPreis' }),
      'Price per unit',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Use this name' }))
    await openTechnicalOptions(canvasElement)
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Character encoding' }),
      'windows-1252',
    )
    await canvas.findByRole('heading', { name: readingTitle })
    await review(canvasElement)
    await expect(canvas.getByText('All names checked')).toBeVisible()
    await expect(canvas.getAllByText('Price per unit').length).toBeGreaterThan(0)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'The first row names the columns' }))
    await canvas.findByRole('heading', { name: readingTitle })
    await review(canvasElement)
    await expect(canvas.queryByText('All names checked')).toBeNull()
    await expect(canvas.queryAllByText('Price per unit')).toHaveLength(0)
  },
})

export const JsonSchemaAfterFile = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await openTechnicalOptions(canvasElement)
    await userEvent.upload(
      canvas.getByLabelText(/^JSON Schema/),
      toFile(documentStructureOrigins.jsonSchema.jsonSchema),
    )
    await review(canvasElement, 'Fields read from the JSON Schema')
    await expect(canvas.getByRole('textbox', { name: 'Name of this data format' })).toHaveValue(
      'article',
    )
  },
})

export const EditedNameKept = meta.story({
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Name of this data format' })

    await userEvent.clear(name)
    await userEvent.type(name, 'ERP invoices')
    await openTechnicalOptions(canvasElement)
    await userEvent.upload(
      canvas.getByLabelText(/^JSON Schema/),
      toFile(documentStructureOrigins.jsonSchema.jsonSchema),
    )
    await review(canvasElement, 'Fields read from the JSON Schema')
    await expect(canvas.getByRole('textbox', { name: 'Name of this data format' })).toHaveValue(
      'ERP invoices',
    )
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(inferencePath, () => HttpResponse.json(wideInferred)))
  },
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, wideExport)
    await review(canvasElement, 'Fields read from artikelstamm-breit.csv')
    await expect(canvas.getByText('200 fields found')).toBeVisible()
    await expect(canvas.getByText('4 names to check')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Check 4 names first' })).toBeDisabled()
    await expectNoPageScroll(canvasElement)
  },
})

export const GermanDrop = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Neues Datenformat' }),
    ).toBeInTheDocument()
    await expect(canvas.getByLabelText(/^Legen Sie einen Export/)).toHaveAttribute('type', 'file')
    await expect(canvas.getByRole('button', { name: 'Technische Optionen' })).toBeVisible()
  },
})

export const GermanReading = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureInferenceState: 'loading' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport, /^Legen Sie einen Export/)
    await expect(
      await canvas.findByRole('heading', { name: 'Rechnungsexport_2026-10-08.csv wird gelesen' }),
    ).toBeVisible()
    await expect(
      await canvas.findByText('12 Spalten gefunden, getrennt durch Semikolons'),
    ).toBeVisible()
    await expect(canvas.getByText(/^Felder in einfachen Worten benennen/)).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport, /^Legen Sie einen Export/)
    await review(canvasElement, 'Felder aus Rechnungsexport_2026-10-08.csv')
    await expect(canvas.getByRole('button', { name: 'Zuerst 2 Namen prüfen' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: 'Ja, „Unit price“ stimmt' })).toBeVisible()
  },
})

export const GermanFieldNamesWithoutAi = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { documentStructureFieldNamesNotice: 'aiBudgetExhausted' }))
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport, /^Legen Sie einen Export/)
    await review(canvasElement, 'Felder aus Rechnungsexport_2026-10-08.csv')
    const notice = within(await canvas.findByRole('status', { name: 'Felder ohne KI benannt' }))

    await expect(
      notice.getByText(
        'Das KI-Budget für heute ist aufgebraucht, daher stammen die Feldnamen aus der Datei. Prüfen Sie sie und ändern Sie bei Bedarf unten jeden Namen.',
      ),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, “Unit” is right' }))
    await expect(canvas.getByText('1 name to check')).toBeVisible()
  },
})

export const DarkReading = meta.story({
  beforeEach(context) {
    context.msw.use(...createHandlers(apiUrl, { documentStructureInferenceState: 'loading' }))

    return darkMode()
  },
  async play({ canvas, canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await expect(await canvas.findByText('Naming the fields in plain words')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvasElement }) {
    await drop(canvasElement, invoiceExport)
    await review(canvasElement)
    await expectNoPageScroll(canvasElement)
  },
})

export const Viewer = meta.story({
  render: () => (
    <CanChangeOnly>
      <NewDocumentStructureScreen />
    </CanChangeOnly>
  ),
  ...viewerStory({
    async play({ canvas }) {
      await expect(canvas.getByRole('heading', { name: 'Page not found' })).toBeVisible()
      await expect(canvas.queryByLabelText(dropLabel)).toBeNull()
    },
  }),
})
