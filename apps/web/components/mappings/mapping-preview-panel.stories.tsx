import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import type { queries, within } from 'storybook/test'

import { openDetails } from '@/components/mappings/mapping-canvas-story-helpers'
import { MappingPreviewSheet } from '@/components/mappings/mapping-preview-panel'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingPreviewEndpoint, mappingSamplesEndpoint } from '@edi-bridge/contracts'
import {
  createHandlers,
  createMappingSample,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  toMappingDraft,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function draftNamed(name: string) {
  const record = seedMappingDrafts.find((draft) => draft.name === name)!

  return { record, draft: toMappingDraft(record, seedDocumentStructures) }
}

const desadv = draftNamed('Hansemarkt: ERP JSON to DESADV')

const orders = draftNamed('Hansemarkt: ORDERS to ERP JSON')

// The seed's expression is invalid on purpose; a valid one shows that EDIFACT sources skip JSONata.
const ordersWithValidExpression = {
  ...orders.draft,
  transforms: orders.draft.transforms.map((transform) =>
    transform.kind === 'jsonata'
      ? { ...transform, config: { expression: '$string(SG25.PIA)' } }
      : transform,
  ),
}

const unpublished = toMappingDraft(
  seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!,
  seedDocumentStructures,
)

const [firstSample, secondSample] = seedMappingSamples.filter(
  ({ mappingId }) => mappingId === desadv.record.id,
)

const largeSample = createMappingSample({
  mapping: desadv.record,
  documentStructure: seedDocumentStructureOf.DESADV,
  lineCount: 2000,
})

const samplesUrl = `${apiUrl}${mappingSamplesEndpoint.path}`

const previewUrl = `${apiUrl}${mappingPreviewEndpoint.path}`

type SheetQueries = ReturnType<typeof within<typeof queries>>

function openPreview(canvasElement: HTMLElement, name = 'Preview'): Promise<SheetQueries> {
  return openDetails(canvasElement, name)
}

function targetDocument(sheet: SheetQueries, sample: string, timeout = 1000) {
  return sheet.findByRole('region', { name: `Target Document for ${sample}` }, { timeout })
}

async function showSample(sheet: SheetQueries) {
  await userEvent.click(await sheet.findByRole('button', { name: 'Example document' }))
}

const meta = preview.meta({
  title: 'Mappings/MappingPreviewSheet',
  component: MappingPreviewSheet,
  args: { draft: desadv.draft },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const SampleChosen = meta.story({
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)
    const target = await targetDocument(canvas, firstSample!.name)

    await waitFor(() => expect(target).toHaveTextContent(/BGM\+351\+DN-2026-\d{5}'/))
    await showSample(canvas)
    await expect(
      canvas.getByRole('region', { name: `Example document ${firstSample!.name}` }),
    ).toHaveTextContent('"despatchNumber"')
    await expect(canvas.getByText('2 targets left empty')).toBeVisible()
    await expect(canvas.getByText('Code translation 1 has an invalid configuration.')).toBeVisible()

    await userEvent.click(canvas.getByRole('combobox', { name: 'Example document' }))
    await userEvent.click(await screen.findByRole('option', { name: secondSample!.name }))

    await userEvent.click(canvas.getByRole('button', { name: 'Target Document' }))
    await expect(await targetDocument(canvas, secondSample!.name)).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(
        `Preview updated for ${secondSample!.name}`,
      ),
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Close preview' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const reopened = await openPreview(canvasElement)

    await expect(
      await reopened.findByRole('combobox', { name: 'Example document' }),
    ).toHaveTextContent(secondSample!.name)
  },
})

export const InboundSample = meta.story({
  args: { draft: ordersWithValidExpression },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(
      await canvas.findByRole('region', { name: /^Target Document for / }),
    ).toHaveTextContent('"orderNumber"')
    await expect(
      await canvas.findByText(
        'JSONata expression 1 is not previewed on EDIFACT example documents yet.',
      ),
    ).toBeVisible()
    await showSample(canvas)
    await expect(
      await canvas.findByRole('region', { name: /^Example document po-2026-\d{5}\.edi$/ }),
    ).toHaveTextContent(/UNH\+\d+\+ORDERS:D:96A:UN:EAN008'/)
  },
})

export const EmptySamples = meta.story({
  args: { draft: unpublished },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await canvas.findByText('No example documents yet')).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Example document' })).toBeNull()
  },
})

export const LoadingSamples = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(samplesUrl, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await canvas.findByText('Loading the example documents')).toBeInTheDocument()
  },
})

export const BuildingPreview = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(previewUrl, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await canvas.findByText('Building the preview')).toBeInTheDocument()
    await showSample(canvas)
    await expect(
      canvas.getByRole('region', { name: `Example document ${firstSample!.name}` }),
    ).toBeVisible()
  },
})

export const SamplesUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get(samplesUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The example documents could not be loaded.',
    )
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const PreviewUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The preview could not be built.',
    )
  },
})

const engineStopped = {
  sampleId: firstSample!.id,
  document: { format: 'edifact', content: '' },
  notes: [
    { targetPath: 'SG2+SU/NAD+SU/C082/3039', transformId: null, code: 'missingRequiredValue' },
  ],
}

const germanMessages = (Story: () => React.ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

export const EngineStopped = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json(engineStopped)))
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(
      await canvas.findByRole('heading', {
        name: 'The preview stopped and built no target Document',
      }),
    ).toBeVisible()
    await expect(canvas.queryByText('1 target left empty')).not.toBeInTheDocument()
    await expect(canvas.getByText('This required value is not filled.')).toBeVisible()
    await expect(canvas.getByText('SG2+SU/NAD+SU/C082/3039')).toBeVisible()
  },
})

export const EngineStoppedGerman = meta.story({
  decorators: [germanMessages],
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json(engineStopped)))
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement, 'Vorschau')

    await expect(
      await canvas.findByRole('heading', {
        name: 'Die Vorschau hat angehalten und keinen Zielbeleg erstellt',
      }),
    ).toBeVisible()
    await expect(canvas.getByText('Dieser Pflichtwert ist nicht gefüllt.')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingSamples: [largeSample] }))
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)
    // The mock builds the 2,000-line preview before the region renders, which takes up to 6 s on CI.
    const target = await targetDocument(canvas, largeSample.name, 10_000)

    await waitFor(
      () => expect(target.textContent?.match(/^LIN\+/gm)?.length ?? 0).toBeGreaterThanOrEqual(2000),
      { timeout: 5000 },
    )
    await expect(target.scrollHeight).toBeGreaterThan(target.clientHeight)
  },
})

export const German = meta.story({
  decorators: [germanMessages],
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement, 'Vorschau')

    await expect(canvas.getByRole('heading', { name: 'Vorschau' })).toBeVisible()
    await expect(
      await canvas.findByRole('region', { name: `Zielbeleg für ${firstSample!.name}` }),
    ).toBeVisible()
    await expect(await canvas.findByText('2 Ziele bleiben leer')).toBeVisible()
    await expect(canvas.getByText('Code-Übersetzung 1 ist ungültig konfiguriert.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Vorschau schließen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    const canvas = await openPreview(canvasElement)

    await expect(await targetDocument(canvas, firstSample!.name)).toBeVisible()
    await expect(await canvas.findByText('Up to date')).toBeVisible()
  },
})
