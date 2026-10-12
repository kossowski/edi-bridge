import { useQuery } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { useId } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AppPage } from '@/components/app-page'
import { inReview, page, seeded } from '@/components/mappings/mapping-canvas-story-helpers'
import { DraftStateLabel } from '@/components/mappings/publish-draft'
import { VersionsSheet } from '@/components/mappings/versions-sheet'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { mappingDraftQuery } from '@/lib/api/queries'
import {
  aiReviewOpenStatus,
  type MappingVersionEntry,
  mappingVersionsEndpoint,
  type PinnedFlow,
  restoreMappingVersionEndpoint,
  type RunList,
  runsEndpoint,
} from '@edi-bridge/contracts'
import {
  createHandlers,
  createMappingDrafts,
  createMappingVersions,
  createRun,
  type MappingDraftRecord,
  seedMappingDrafts,
} from '@edi-bridge/mocks'
import { Toaster } from '@edi-bridge/ui/components/sonner'

import preview from '../../.storybook/preview'

const published = seeded('Hansemarkt: ORDERS to ERP JSON')

const neverPublished = seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!

const reviewing = inReview('Rheinkauf: ORDERS to ERP JSON')

const [long] = createMappingDrafts({ count: 1 }).map((draft) => ({
  ...draft,
  latestVersion: 120,
  unpublishedChanges: true,
}))

const versionsPath = `${apiUrl}${mappingVersionsEndpoint.path}`

const restorePath = `${apiUrl}${restoreMappingVersionEndpoint.path}`

const runsPath = `${apiUrl}${runsEndpoint.path}`

function pinnedFlows(count: number, offset = 0): PinnedFlow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Orders by AS2, route ${index + offset + 1}`,
    tradingPartner: {
      id: crypto.randomUUID(),
      name: `Großhandel ${String.fromCodePoint(65 + ((index + offset) % 26))} Nord GmbH & Co. KG`,
    },
  }))
}

function route(name: string, partner: string): PinnedFlow {
  return {
    id: crypto.randomUUID(),
    name,
    tradingPartner: { id: crypto.randomUUID(), name: partner },
  }
}

function versionEntries(
  draft: MappingDraftRecord,
  flowsByVersion: ReadonlyMap<number, PinnedFlow[]>,
): MappingVersionEntry[] {
  return createMappingVersions([draft]).map(
    ({ id, mappingId, mappingName, version, publishedAt, changeNote, publishedBy }) => ({
      id,
      mappingId,
      mappingName,
      version,
      publishedAt,
      changeNote,
      publishedBy,
      flows: flowsByVersion.get(version) ?? [],
    }),
  )
}

const longVersions = versionEntries(
  long!,
  new Map([
    [120, pinnedFlows(40)],
    [117, pinnedFlows(12, 40)],
  ]),
)

const stillUsedVersions = versionEntries(
  published,
  new Map([
    [3, [route('Orders by AS2', 'Hansemarkt GmbH')]],
    [2, [route('Orders by SFTP', 'Elbtal Warenhaus KG')]],
    [1, [route('Orders by mail', 'Alpenfrisch AG')]],
  ]),
)

const manyFailed: RunList = {
  runs: Array.from({ length: 20 }, (_, index) =>
    createRun({
      status: 'failed',
      failureStage: 'mapping',
      receivedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
    }),
  ),
  statusCounts: { received: 0, processing: 0, delivered: 0, failed: 57, duplicate: 0 },
  total: 57,
  page: 1,
  pageSize: 20,
}

function VersionsHarness({ id }: { id: string }) {
  const { data: draft } = useQuery(mappingDraftQuery(id))
  const stateId = useId()

  return draft ? (
    <AppPage
      actions={<VersionsSheet draft={draft} />}
      meta={<DraftStateLabel id={stateId} draft={draft} />}
      name={draft.name}>
      {null}
    </AppPage>
  ) : null
}

async function openSheet(canvasElement: HTMLElement, name = 'Versions & problems') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))

  const sheet = await page(canvasElement).findByRole('dialog', { name }, { timeout: 5000 })

  await waitFor(() => expect(sheet).toBeVisible(), { timeout: 5000 })

  return within(sheet)
}

const meta = preview.meta({
  title: 'Mappings/VersionsSheet',
  component: VersionsHarness,
  parameters: { layout: 'fullscreen' },
  args: { id: published.id },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const WithHistory = meta.story({
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Version 1' })).toBeInTheDocument()
    await expect(
      sheet.getByRole('link', { name: 'Compare with previous (version 2 to 3)' }),
    ).toHaveAttribute('href', expect.stringMatching(`/mappings/${published.id}/versions/compare`))
    await expect(sheet.getAllByRole('link', { name: /^Compare with previous/ })).toHaveLength(2)
    await expect(sheet.getByText('Version 3 is live for Hansemarkt GmbH.')).toBeVisible()
    await expect(sheet.getByText('Prices rounded to two decimal places')).toBeVisible()
    await expect(sheet.getAllByText('No note')).toHaveLength(2)
    await expect(sheet.getAllByText('Live')).toHaveLength(1)
    await expect(sheet.queryByText('Still in use')).toBeNull()
    await expect(
      sheet.queryByRole('button', { name: 'Restore into Draft (version 3)' }),
    ).not.toBeInTheDocument()
    await expect(
      sheet.getByRole('button', { name: 'Restore into Draft (version 2)' }),
    ).toBeEnabled()
    await expect(
      await sheet.findByRole('heading', { name: 'Failed documents, last 7 days' }),
    ).toBeVisible()
    await waitFor(() => expect(sheet.queryByText('Loading the failed documents')).toBeNull())
  },
})

export const OlderVersionsStillInUse = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get(versionsPath, () => HttpResponse.json(stillUsedVersions)))
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(
      await sheet.findByText(
        'Version 3 is live for Hansemarkt GmbH. Version 2 is still used by Elbtal Warenhaus KG. Version 1 is still used by Alpenfrisch AG.',
      ),
    ).toBeVisible()
    await expect(sheet.getAllByText('Live')).toHaveLength(1)
    await expect(sheet.getAllByText('Still in use')).toHaveLength(2)
  },
})

export const Keyboard = meta.story({
  async play({ canvasElement }) {
    const trigger = await within(canvasElement).findByRole('button', {
      name: 'Versions & problems',
    })

    trigger.focus()
    await userEvent.keyboard('{Enter}')

    const dialog = await page(canvasElement).findByRole('dialog', { name: 'Versions & problems' })
    const sheet = within(dialog)

    await sheet.findByRole('button', { name: 'Restore into Draft (version 1)' })
    await waitFor(() => expect(sheet.queryByText('Loading the failed documents')).toBeNull())

    const stops: string[] = []

    while (stops.length < 40 && (stops.length < 2 || stops.at(-1) !== stops[0])) {
      await userEvent.tab()
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
      stops.push(document.activeElement?.textContent ?? '')
    }

    await expect(stops.at(-1)).toBe(stops[0])
    await expect(stops).toContain('Close versions and problems')
    await expect(stops.slice(0, -1).filter((stop) => /^(Compare|Restore)/.test(stop))).toEqual([
      'Compare with previous (version 2 to 3)',
      'Compare with previous (version 1 to 2)',
      'Restore into Draft (version 2)',
      'Restore into Draft (version 1)',
    ])
  },
})

export const FailedDocuments = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get(runsPath, () => HttpResponse.json(manyFailed)))
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const [first] = manyFailed.runs

    await expect(await sheet.findByText('Showing the latest 20 of 57.')).toBeVisible()
    await expect(
      sheet
        .getAllByRole('link')
        .find((link) => link.getAttribute('href') === `/documents/${first!.id}`),
    ).toBeDefined()
  },
})

export const NoFailedDocuments = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(runsPath, () =>
        HttpResponse.json({ ...manyFailed, runs: [], total: 0 } satisfies RunList),
      ),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByText('None.')).toBeVisible()
  },
})

export const NeverPublished = meta.story({
  args: { id: neverPublished.id },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByText(/^Nothing published yet/)).toBeVisible()
    await expect(
      sheet.getByText('Not published yet, so no document route uses this Mapping.'),
    ).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath, async () => {
        await delay('infinite')

        return HttpResponse.json([])
      }),
      http.get(runsPath, async () => {
        await delay('infinite')

        return HttpResponse.json(manyFailed)
      }),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(sheet.getByText('Loading the versions')).toBeInTheDocument()
    await expect(sheet.getByText('Loading the failed documents')).toBeInTheDocument()
  },
})

export const LoadError = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath, () => new HttpResponse(null, { status: 500 })),
      http.get(runsPath, () => new HttpResponse(null, { status: 500 })),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByText('Versions unavailable')).toBeVisible()
    await expect(await sheet.findByText('Failed documents unavailable')).toBeVisible()
    await expect(sheet.getAllByRole('button', { name: 'Try again' })).toHaveLength(2)
  },
})

export const FailedDocumentsError = meta.story({
  beforeEach({ msw }) {
    let failing = true

    msw.use(
      http.get(runsPath, () => {
        if (failing) {
          failing = false

          return new HttpResponse(null, { status: 500 })
        }

        return HttpResponse.json(manyFailed)
      }),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByText('Failed documents unavailable')).toBeVisible()
    await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Try again' }))
    await expect(await sheet.findByText('Showing the latest 20 of 57.')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: long!.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath, () => HttpResponse.json(longVersions)),
      http.get(runsPath, () => HttpResponse.json(manyFailed)),
      ...createHandlers(apiUrl, { mappingDrafts: [...seedMappingDrafts, long!] }),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByRole('heading', { name: 'Version 120' })).toBeVisible()
    await expect(sheet.getAllByRole('heading', { level: 4 })).toHaveLength(120)
    await expect(sheet.getByText('Used by 40 document routes:')).toBeVisible()
    await expect(sheet.getByText('Used by 12 document routes:')).toBeVisible()
    await expect(sheet.getAllByText('Live')).toHaveLength(1)
    await expect(sheet.getAllByText('Still in use')).toHaveLength(1)
    await expect(
      sheet.getByText(/^Version 120 is live for .+ Version 117 is still used by /),
    ).toBeVisible()
    await expect(
      sheet.getByRole('button', { name: 'Restore into Draft (version 120)' }),
    ).toBeEnabled()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvasElement }) {
      const sheet = await openSheet(canvasElement)

      await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
      await expect(
        sheet.getByRole('link', { name: 'Compare with previous (version 2 to 3)' }),
      ).toBeVisible()
      await expect(sheet.queryByRole('button', { name: /^Restore/ })).toBeNull()
    },
  }),
})

export const Restore = meta.story({
  async play({ canvasElement, canvas }) {
    await expect(await canvas.findByText('No changes since Version 3')).toBeVisible()

    const sheet = await openSheet(canvasElement)
    const restore = await sheet.findByRole('button', { name: 'Restore into Draft (version 1)' })

    await userEvent.click(restore)

    const confirmation = await page(canvasElement).findByRole('alertdialog', {
      name: 'Restore version 1 into the Draft?',
    })

    await waitFor(() => expect(confirmation).toBeVisible())
    await expect(confirmation).toHaveAccessibleDescription(
      'This overwrites the links and Transforms of the Draft with those of version 1. Nothing goes live until you publish.',
    )
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Restore version 1' }))

    const toast = await page(canvasElement).findByText(
      'Version 1 restored into the Draft. It goes live once you publish.',
    )

    await waitFor(() => expect(toast).toBeVisible())
    await expect(await canvas.findByText('Unpublished changes since Version 3')).toBeVisible()
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
  },
})

export const RestoreFails = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(restorePath, () => new HttpResponse(null, { status: aiReviewOpenStatus })))
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await userEvent.click(
      await sheet.findByRole('button', { name: 'Restore into Draft (version 2)' }),
    )

    const confirmation = within(
      await page(canvasElement).findByRole('alertdialog', {
        name: 'Restore version 2 into the Draft?',
      }),
    )

    await userEvent.click(confirmation.getByRole('button', { name: 'Restore version 2' }))
    await expect(await confirmation.findByRole('alert')).toHaveTextContent(
      'No version can be restored while the AI review of the Draft is open. Accept the AI draft first, then restore.',
    )
  },
})

export const ReviewOpen = meta.story({
  args: { id: reviewing.id },
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: seedMappingDrafts.map((draft) =>
          draft.id === reviewing.id ? reviewing : draft,
        ),
      }),
    )
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const [restore] = await sheet.findAllByRole('button', { name: /^Restore into Draft/ })

    await expect(restore).toHaveAttribute('aria-disabled', 'true')
    await expect(restore).toHaveAccessibleDescription(
      'A version can be restored once the AI review is done.',
    )
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(http.get(versionsPath, () => HttpResponse.json(stillUsedVersions)))
  },
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement, 'Versionen & Probleme')

    await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
    await expect(
      sheet.getByRole('heading', { name: 'Fehlgeschlagene Belege, letzte 7 Tage' }),
    ).toBeVisible()
    await expect(
      sheet.getByText(
        'Version 3 ist live für Hansemarkt GmbH. Version 2 wird noch von Elbtal Warenhaus KG genutzt. Version 1 wird noch von Alpenfrisch AG genutzt.',
      ),
    ).toBeVisible()
    await expect(sheet.getAllByText('Noch in Nutzung')).toHaveLength(2)
  },
})

export const Dark = meta.story({
  beforeEach: () => darkMode(),
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await sheet.findByRole('heading', { name: 'Version 3' })).toBeVisible()
  },
})
