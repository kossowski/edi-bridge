import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { MappingComparisonScreen } from '@/components/mappings/mapping-comparison-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingComparisonEndpoint, toPath } from '@edi-bridge/contracts'
import {
  createHandlers,
  createMappingSample,
  createMappingVersions,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  showcaseViewerSession,
  toMappingVersionSummary,
} from '@edi-bridge/mocks'

import type { Session } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

const published = seedMappingDrafts.find(({ name }) => name === 'Hansemarkt: ORDERS to ERP JSON')!

const [latest, previous, first] = createMappingVersions([published])

const samples = seedMappingSamples.filter(({ mappingId }) => mappingId === published.id)

const unknownId = '00000000-0000-4000-8000-000000000000'

const comparisonPath = `${apiUrl}${toPath(mappingComparisonEndpoint.path, { mappingId: published.id })}`

const largeSample = createMappingSample({
  mapping: published,
  documentStructure: seedDocumentStructures.find(({ id }) => id === published.documentStructureId)!,
  index: 7,
  lineCount: 400,
})

const meta = preview.meta({
  title: 'Mappings/MappingComparisonScreen',
  component: MappingComparisonScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: published.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Mapping differences' })).toBeVisible()
    await expect(
      await canvas.findByText(/differences: \d+ added/, {}, { timeout: 5000 }),
    ).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Output differences' })).toBeVisible()

    await expect(
      await canvas.findByRole(
        'region',
        { name: `Target Document of Version ${previous!.version}` },
        { timeout: 5000 },
      ),
    ).toBeVisible()
    await expect(
      canvas.getByRole('region', { name: `Target Document of Version ${latest!.version}` }),
    ).toBeVisible()
  },
})

export const ChosenVersionsAndSample = meta.story({
  args: { from: first!.id, to: latest!.id, sample: samples[1]!.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/differences: \d+ added/, {}, { timeout: 5000 }),
    ).toBeVisible()

    const table = within(canvas.getAllByRole('table')[0]!)

    await expect(table.getByRole('columnheader', { name: 'Version 1' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Version 3' })).toBeVisible()
    await expect(
      await canvas.findByText(
        new RegExp(`\\d+ (value differs|values differ) for ${samples[1]!.name}`),
        {},
        { timeout: 5000 },
      ),
    ).toBeVisible()
  },
})

export const NotesAndEmptyValue = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(comparisonPath, ({ request }) => {
        const sampleId = new URL(request.url).searchParams.get('sampleId')
        const document = samples[0]!.document

        return HttpResponse.json({
          mappingId: published.id,
          from: toMappingVersionSummary(previous!),
          to: toMappingVersionSummary(latest!),
          differences: [],
          outputs: sampleId
            ? {
                sampleId,
                from: { document, notes: [] },
                to: {
                  document,
                  notes: [{ targetPath: 'orderNumber', transformId: null, code: 'brokenLink' }],
                },
                differences: [
                  { path: 'orderNumber', repetitions: [], before: 'PO-4711', after: '' },
                  { path: 'buyer.reference', repetitions: [], before: null, after: 'HM-01' },
                ],
              }
            : null,
        })
      }),
    )
  },
  async play({ canvas }) {
    const table = await canvas.findByRole(
      'region',
      { name: 'Values that differ, by target and repetition' },
      { timeout: 5000 },
    )

    await expect(table).toHaveAttribute('tabindex', '0')
    await expect(within(table).getByText('Empty')).toBeVisible()
    await expect(within(table).getByText('Not set')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: '1 target left empty' })).toBeVisible()
    await expect(
      canvas.getByText(/A link here reaches a field or element its side does not have/),
    ).toBeVisible()
  },
})

export const NoDifferences = meta.story({
  beforeEach({ msw }) {
    const versions = createMappingVersions([published]).map((version) => ({
      ...version,
      links: latest!.links,
      transforms: latest!.transforms,
      transformLinks: latest!.transformLinks,
    }))

    msw.use(...createHandlers(apiUrl, { mappingVersions: versions }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No mapping differences')).toBeVisible()
    await expect(await canvas.findByText('Same output', {}, { timeout: 5000 })).toBeVisible()
  },
})

function tooFewVersions(options: { session?: Session } = {}) {
  const draft = { ...published, latestVersion: 1, unpublishedChanges: true }

  return createHandlers(apiUrl, {
    ...options,
    mappingDrafts: [draft],
    mappingVersions: createMappingVersions([draft]),
  })
}

export const TooFewVersions = meta.story({
  beforeEach({ msw }) {
    msw.use(...tooFewVersions())
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Nothing to compare yet')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open the Draft' })).toHaveAttribute(
      'href',
      `/mappings/${published.id}`,
    )
  },
})

export const ViewerTooFewVersions = meta.story({
  ...viewerStory({
    beforeEach({ msw }) {
      msw.use(...tooFewVersions({ session: showcaseViewerSession }))
    },
    async play({ canvas }) {
      await expect(
        await canvas.findByText(
          'A comparison needs at least two versions. Another one appears here once an Admin publishes the draft.',
        ),
      ).toBeVisible()
      await expect(canvas.getByRole('link', { name: 'Open the Draft' })).toBeVisible()
    },
  }),
})

export const NoSampleDocuments = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingSamples: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No example documents yet')).toBeVisible()
  },
})

export const UnknownVersion = meta.story({
  args: { from: unknownId },
  async play({ canvas }) {
    await expect(await canvas.findByText('Version not found')).toBeVisible()
  },
})

export const SameVersion = meta.story({
  args: { from: latest!.id, to: latest!.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('The same version twice')).toBeVisible()
  },
})

export const UnknownSampleDocument = meta.story({
  args: { sample: unknownId },
  async play({ canvas }) {
    await expect(await canvas.findByText('Example document not found')).toBeVisible()
    await expect(
      await canvas.findByText(/differences: \d+ added/, {}, { timeout: 5000 }),
    ).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(comparisonPath, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the mapping differences')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(comparisonPath, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    // The comparison is asked for only once the Mapping and its versions have loaded, a chain of
    // requests that a busy CI runner answers later than the default second.
    await expect(
      await canvas.findByText('Mapping differences unavailable', {}, { timeout: 5000 }),
    ).toBeVisible()
    await expect(
      await canvas.findByText('Outputs unavailable', {}, { timeout: 5000 }),
    ).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: unknownId },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mapping not found')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { from: first!.id, to: latest!.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingSamples: [largeSample] }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('button', { name: /^Show \d+ more$/ }, { timeout: 10_000 }),
    ).toBeVisible()
    await expect(canvas.getByText(/^Showing 100 of \d+$/)).toBeVisible()
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
    await expect(
      await canvas.findByRole('heading', { name: 'Unterschiede im Mapping' }),
    ).toBeVisible()
    await expect(
      await canvas.findByText(/Unterschiede: \d+ hinzugefügt/, {}, { timeout: 5000 }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/differences: \d+ added/, {}, { timeout: 5000 }),
    ).toBeVisible()
  },
})
