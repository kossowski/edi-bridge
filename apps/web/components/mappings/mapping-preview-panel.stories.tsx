import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { MappingPreviewPanel } from '@/components/mappings/mapping-preview-panel'
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

function targetDocument(canvasElement: HTMLElement, sample: string) {
  return within(canvasElement).findByRole('region', { name: `Target Document for ${sample}` })
}

const meta = preview.meta({
  title: 'Mappings/MappingPreviewPanel',
  component: MappingPreviewPanel,
  args: { draft: desadv.draft },
  decorators: [
    (Story) => (
      <div className="w-[64rem] p-6">
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const SampleChosen = meta.story({
  async play({ canvas, canvasElement }) {
    const target = await targetDocument(canvasElement, firstSample!.name)

    await waitFor(() => expect(target).toHaveTextContent(/BGM\+351\+DN-2026-\d{5}'/))
    await expect(
      canvas.getByRole('region', { name: `Sample Document ${firstSample!.name}` }),
    ).toHaveTextContent('"despatchNumber"')
    await expect(canvas.getByText('2 targets left empty')).toBeVisible()
    await expect(canvas.getByText('Lookup Table 1 has an invalid configuration.')).toBeVisible()

    await userEvent.click(canvas.getByRole('combobox', { name: 'Sample' }))
    await userEvent.click(await screen.findByRole('option', { name: secondSample!.name }))

    await expect(await targetDocument(canvasElement, secondSample!.name)).toBeVisible()
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(
        `Preview updated for ${secondSample!.name}`,
      ),
    )

    await userEvent.click(canvas.getByRole('button', { name: 'Hide preview' }))
    await expect(canvas.queryByRole('combobox', { name: 'Sample' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Show preview' }))
    await expect(await canvas.findByRole('combobox', { name: 'Sample' })).toBeVisible()
  },
})

export const InboundSample = meta.story({
  args: { draft: orders.draft },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('region', { name: /^Sample Document po-2026-\d{5}\.edi$/ }),
    ).toHaveTextContent(/UNH\+\d+\+ORDERS:D:96A:UN'/)
    await expect(
      await canvas.findByRole('region', { name: /^Target Document for / }),
    ).toHaveTextContent('"orderNumber"')
    await expect(
      await canvas.findByText('JSONata expression 1 has an invalid configuration.'),
    ).toBeVisible()
  },
})

export const EmptySamples = meta.story({
  args: { draft: unpublished },
  async play({ canvas }) {
    await expect(await canvas.findByText('No samples yet')).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Sample' })).toBeNull()
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
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the samples')).toBeInTheDocument()
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
  async play({ canvas }) {
    await expect(await canvas.findByText('Building the preview')).toBeInTheDocument()
    await expect(
      canvas.getByRole('region', { name: `Sample Document ${firstSample!.name}` }),
    ).toBeVisible()
  },
})

export const SamplesUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get(samplesUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The samples could not be loaded.',
    )
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const PreviewUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The preview could not be built.',
    )
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingSamples: [largeSample] }))
  },
  async play({ canvasElement }) {
    const target = await targetDocument(canvasElement, largeSample.name)

    await waitFor(
      () => expect(target.textContent?.match(/^LIN\+/gm)?.length ?? 0).toBeGreaterThanOrEqual(2000),
      { timeout: 5000 },
    )
    await expect(target.scrollHeight).toBeGreaterThan(target.clientHeight)
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
    await expect(await canvas.findByRole('heading', { name: 'Vorschau' })).toBeVisible()
    await expect(
      await canvas.findByRole('region', { name: `Ziel-Document für ${firstSample!.name}` }),
    ).toBeVisible()
    await expect(await canvas.findByText('2 Ziele bleiben leer')).toBeVisible()
    await expect(canvas.getByText('Lookup Table 1 ist ungültig konfiguriert.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Vorschau ausblenden' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    await expect(await targetDocument(canvasElement, firstSample!.name)).toBeVisible()
    await expect(await within(canvasElement).findByText('Up to date')).toBeVisible()
  },
})
