import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { toFile } from '@/components/document-structures/document-structure-story-helpers'
import { NewDocumentStructureScreen } from '@/components/document-structures/new-document-structure-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createDocumentStructureEndpoint, type FieldLabelChoice } from '@edi-bridge/contracts'
import { createHandlers, documentStructureOrigins } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const invoiceExport = toFile(documentStructureOrigins.invoiceCsvDocument.document)

const dropLabel = /^Drop an export from your ERP/

const reviewTitle = 'Fields read from Rechnungsexport_2026-10-08.csv'

const createPath = `${apiUrl}${createDocumentStructureEndpoint.path}`

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
    await expect(
      await canvas.findByRole('heading', { name: 'Reading Rechnungsexport_2026-10-08.csv' }),
    ).toBeVisible()
    const steps = canvas.getAllByRole('listitem')

    await expect(steps[0]).toHaveTextContent('Opening the file: done')
    await expect(steps[1]).toHaveTextContent('Finding the columns: in progress')
    await expect(steps[1]).toHaveAttribute('aria-current', 'step')
    await expect(steps[2]).toHaveTextContent('Naming the fields in plain words: not started')
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
    await expect(labels).toEqual([
      { path: 'rows[].ME', label: 'Unit' },
      { path: 'rows[].EPreis', label: 'Price per unit' },
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
    await expect(canvas.getByRole('button', { name: 'Name the format first' })).toBeDisabled()
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
    await userEvent.selectOptions(
      canvas.getByRole('combobox', { name: 'Character encoding' }),
      'windows-1252',
    )
    await review(canvasElement, 'Fields read from lieferscheine-ansi.csv')
    const values = canvas.getByRole('group', { name: /lieferscheine-ansi\.csv/ })

    await expect(within(values).getAllByText('Lübeck').length).toBeGreaterThan(0)
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
    await expect(await canvas.findByText('Finding the columns')).toBeVisible()
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
