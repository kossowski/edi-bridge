import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { NewDocumentStructureScreen } from '@/components/document-structures/new-document-structure-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  createDocumentStructureEndpoint,
  type EncodedFile,
  inferDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import { createCsvDocument, createHandlers, documentStructureOrigins } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function toFile({ fileName, content }: EncodedFile) {
  return new File(
    [Uint8Array.from(atob(content), (character) => character.charCodeAt(0))],
    fileName,
  )
}

const unclosedQuote = new File(['Nummer;Bemerkung\r\nLS-1;"Kühlware\r\nLS-2;ok'], 'broken.csv')

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

async function choose(canvasElement: HTMLElement, file: File, label = 'File') {
  await userEvent.upload(within(canvasElement).getByLabelText(label), file)
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
    await expect(canvas.getByRole('heading', { name: 'New Document Structure' })).toBeVisible()
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
    await expect(canvas.getByRole('heading', { name: 'CSV settings' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'A CSV Document' })).toBeChecked()
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
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
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
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas, canvasElement }) {
    await choose(canvasElement, toFile(documentStructureOrigins.jsonDocument.document))
    await expect(await canvas.findByRole('treegrid')).toBeVisible()
  },
})
