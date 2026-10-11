import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { toFile } from '@/components/document-structures/document-structure-story-helpers'
import { NewDocumentStructureScreen } from '@/components/document-structures/new-document-structure-screen'
import { besideSidebar, darkMode, german, mobile, tablet } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createDocumentStructureEndpoint,
  inferDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import { createCsvDocument, createHandlers, documentStructureOrigins } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const windows1252 = documentStructureOrigins.windows1252CsvDocument

const unclosedQuote = new File(['Nummer;Bemerkung\r\nLS-1;"Kühlware\r\nLS-2;ok'], 'broken.csv')

async function choose(canvasElement: HTMLElement, file: File, label = 'File') {
  await userEvent.upload(within(canvasElement).getByLabelText(label), file)
}

async function expectPreviewBetween(canvasElement: HTMLElement, settings: string, create: string) {
  const canvas = within(canvasElement)
  const top = (element: HTMLElement) => element.getBoundingClientRect().top
  const firstRows = canvas.getByRole('region', { name: /\.csv$/ })

  await expect(top(firstRows)).toBeGreaterThan(top(canvas.getByRole('group', { name: settings })))
  await expect(top(canvas.getByRole('treegrid'))).toBeGreaterThan(top(firstRows))
  await expect(top(canvas.getByRole('button', { name: create }))).toBeGreaterThan(
    top(canvas.getByRole('treegrid')),
  )
}

const meta = preview.meta({
  title: 'Document Structures/NewDocumentStructureScreen',
  component: NewDocumentStructureScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'New Document Structure' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText('Choose a file to see the Document Structure EDI Bridge infers from it.'),
    ).toBeVisible()
  },
})

export const JsonDocument = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await expect(await canvas.findByRole('treegrid', { name: 'Fields of order' })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue('order')
  },
})

export const CsvDocument = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.csvDocument.document))
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'CSV settings' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'A CSV Document' })).toBeChecked()
    const firstRows = canvas.getByRole('region', { name: 'First rows of lieferscheine.csv' })
    await expect(within(firstRows).getByRole('columnheader', { name: 'Straße' })).toBeVisible()
  },
})

export const Windows1252Umlauts = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(windows1252.document))
    await expect(
      await canvas.findByText(/^The file cannot be read with its character encoding/),
    ).toBeVisible()
    await expect(canvas.getAllByText(/L\uFFFDbeck/).length).toBeGreaterThan(0)
    await expect(canvas.getByLabelText('File')).not.toHaveAttribute('aria-invalid', 'true')
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Character encoding' }),
      'windows-1252',
    )
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    const firstRows = canvas.getByRole('region', { name: 'First rows of lieferscheine-ansi.csv' })
    await expect(within(firstRows).getAllByText('Lübeck').length).toBeGreaterThan(0)
    await expect(within(firstRows).getByText('Kühlware; „bitte zügig“')).toBeVisible()
  },
})

export const CsvWithoutHeaderRow = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.csvDocument.document))
    await canvas.findByRole('treegrid')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'The first row names the columns' }))
    await expect(await canvas.findByRole('columnheader', { name: 'column1' })).toBeVisible()
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvasElement.querySelector('tr[data-path="rows[].column8"]')).not.toBeNull()
  },
})

export const CsvWrongDelimiter = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.csvDocument.document))
    await canvas.findByRole('treegrid')
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Delimiter' }), '|')
    await expect(await canvas.findByText('1 field')).toBeVisible()
    const firstRows = canvas.getByRole('region', { name: 'First rows of lieferscheine.csv' })
    await expect(within(firstRows).getAllByRole('columnheader')).toHaveLength(1)
  },
})

export const TabletCsvSettings = meta.story({
  ...tablet,
  decorators: [besideSidebar, german],
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(windows1252.document), 'Datei')
    await userEvent.selectOptions(
      await canvas.findByRole('combobox', { name: 'Zeichenkodierung' }),
      'windows-1252',
    )
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expectPreviewBetween(canvasElement, 'CSV-Einstellungen', 'Document Structure erstellen')
  },
})

export const MobileCsvSettings = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.csvDocument.document))
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expectPreviewBetween(canvasElement, 'CSV settings', 'Create Document Structure')
  },
})

export const DarkCsvSettings = meta.story({
  beforeEach: darkMode,
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(windows1252.document))
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
})

export const JsonSchema = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonSchema.jsonSchema))
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'A JSON Schema' })).toBeChecked()
  },
})

export const KeepsChosenOrigin = meta.story({
  async play({ canvas, canvasElement }) {
    await userEvent.click(canvas.getByRole('radio', { name: 'A JSON Schema' }))
    await choose(
      canvasElement,
      toFile({ ...documentStructureOrigins.jsonSchema.jsonSchema, fileName: 'order.json' }),
    )
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'A JSON Schema' })).toBeChecked()
  },
})

export const CreateFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createDocumentStructureEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await canvas.findByRole('treegrid')
    await userEvent.click(canvas.getByRole('button', { name: 'Create Document Structure' }))
    const alert = await canvas.findByText('The Document Structure could not be created. Try again.')
    await expect(alert.parentElement).toHaveFocus()
  },
})

export const Tablet = meta.story({
  ...tablet,
  decorators: [besideSidebar, german],
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document), 'Datei')
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    const [field, ...headers] = canvasElement.querySelectorAll('[role=treegrid] th')
    const scroller = canvasElement.querySelector('[data-slot=table-container]')!

    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
    await expect(field!.getBoundingClientRect().width).toBeGreaterThanOrEqual(160)

    for (const header of [field!, ...headers]) {
      await expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
    }
  },
})

export const InvalidJson = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.invalidJsonDocument.document))
    await expect(await canvas.findByText('The file is not valid JSON.')).toBeVisible()
  },
})

export const InvalidCsvLine = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, unclosedQuote)
    await expect(await canvas.findByText('The file is not a valid CSV Document.')).toBeVisible()
    await expect(canvas.getByText(/^Line \d+$/)).toBeVisible()
  },
})

export const Inferring = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${inferDocumentStructureEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await expect(await canvas.findByText('Reading the file…')).toBeInTheDocument()
  },
})

export const LargeCsvDocument = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(createCsvDocument({ rowCount: 20_000 })))
    await expect(await canvas.findByRole('treegrid', {}, { timeout: 5000 })).toBeVisible()
  },
})

export const LargeWindows1252CsvDocument = meta.story({
  async play({ canvas, canvasElement }) {
    await choose(
      canvasElement,
      toFile(createCsvDocument({ rowCount: 1_000, encoding: 'windows-1252' })),
    )
    await userEvent.selectOptions(
      await canvas.findByRole('combobox', { name: 'Character encoding' }),
      'windows-1252',
    )
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
    await expect(canvas.getAllByRole('row').length).toBeGreaterThan(5)
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document), 'Datei')
    await expect(await canvas.findByRole('treegrid', { name: 'Felder von order' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
  },
})
