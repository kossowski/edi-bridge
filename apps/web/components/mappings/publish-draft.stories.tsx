import { useQuery } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { useId } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AppPage } from '@/components/app-page'
import { AiReviewState } from '@/components/mappings/ai-review-state'
import {} from '@/components/mappings/mapping-canvas-story-helpers'
import { DraftStateLabel, PublishDraft } from '@/components/mappings/publish-draft'
import { darkMode, german, page } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { mappingDraftQuery } from '@/lib/api/queries'
import {
  aiReviewOpenStatus,
  maxChangeNoteLength,
  type MappingVersionEntry,
  mappingVersionsEndpoint,
  type PinnedFlow,
  publishMappingDraftBodySchema,
  type PublishMappingDraftBody,
  publishMappingDraftEndpoint,
} from '@edi-bridge/contracts'
import {
  aiProposalFor,
  createHandlers,
  createMappingVersions,
  incompleteDraftId,
  type MappingDraftRecord,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  withAiProposal,
} from '@edi-bridge/mocks'
import { Toaster } from '@edi-bridge/ui/components/sonner'

import preview from '../../.storybook/preview'

const neverPublished = seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!

const changed = seedMappingDrafts.find(
  ({ name, latestVersion }) => name === 'Alpenfrisch: ORDERS to ERP JSON' && latestVersion !== null,
)!

const unchanged = seedMappingDrafts.find(({ name }) => name === 'Hansemarkt: ORDERS to ERP JSON')!

const publishable = {
  ...seedMappingDrafts.find(({ name }) => name === 'Rheinkauf: ORDERS to ERP JSON')!,
  unpublishedChanges: true,
}

const inReview = withAiProposal(
  publishable,
  seedMappingSamples.find(({ mappingId }) => mappingId === publishable.id)!.id,
  aiProposalFor(publishable, seedDocumentStructures),
)

const publishPath = `${apiUrl}${publishMappingDraftEndpoint.path}`

const versionsPath = `${apiUrl}${mappingVersionsEndpoint.path}`

const note = 'Delivery date added'

function flow(name: string, partner: string): PinnedFlow {
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

const hansemarkt = flow('Orders by AS2', 'Hansemarkt GmbH')

const elbtal = flow('Orders by SFTP', 'Elbtal Warenhaus KG')

const alpenfrisch = flow('Orders by mail', 'Alpenfrisch AG')

const severalFlows = versionEntries(
  changed,
  new Map([
    [3, [hansemarkt]],
    [2, [elbtal]],
    [1, [alpenfrisch]],
  ]),
)

const manyFlows = versionEntries(
  changed,
  new Map(
    [3, 2, 1].map((version) => [
      version,
      Array.from({ length: 20 }, (_, index) =>
        flow(
          `Orders by AS2, route ${version * 100 + index}`,
          `Großhandel ${String.fromCodePoint(65 + index)} Nord GmbH & Co. KG`,
        ),
      ),
    ]),
  ),
)

const unusedVersions = versionEntries(changed, new Map())

const publishRequests: PublishMappingDraftBody[] = []

// Answers as the API would and keeps each request body, so a story sees what moves.
function publishHandler(versions: ReadonlyArray<MappingVersionEntry>) {
  const [latest] = [...versions].sort((a, b) => b.version - a.version)

  return http.post(publishPath, async ({ request }) => {
    const body = publishMappingDraftBodySchema.parse(await request.json())

    publishRequests.push(body)

    return HttpResponse.json(
      {
        ...latest!,
        id: crypto.randomUUID(),
        version: latest!.version + 1,
        publishedAt: new Date().toISOString(),
        changeNote: body.changeNote,
        flows: [],
      },
      { status: 201 },
    )
  })
}

function recordPublish(versions: ReadonlyArray<MappingVersionEntry>) {
  return [http.get(versionsPath, () => HttpResponse.json(versions)), publishHandler(versions)]
}

function DraftHeader({ id }: { id: string }) {
  const { data: draft } = useQuery(mappingDraftQuery(id))
  const stateId = useId()
  const publishHintId = useId()

  return draft ? (
    <AppPage
      actions={<PublishDraft draft={draft} reviewHintId={publishHintId} stateId={stateId} />}
      meta={<DraftStateLabel id={stateId} draft={draft} />}
      name={draft.name}>
      <AiReviewState draft={draft} publishHintId={publishHintId} />
    </AppPage>
  ) : null
}

async function openDialog(canvasElement: HTMLElement, button = 'Publish') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: button }))

  const dialog = await page(canvasElement).findByRole('dialog')

  await waitFor(() => expect(dialog).toBeVisible())

  return within(dialog)
}

async function expectToast(canvasElement: HTMLElement, text: string) {
  const toast = await page(canvasElement).findByText(text)

  await waitFor(() => expect(toast).toBeVisible())
}

async function confirmPublish(canvasElement: HTMLElement) {
  const dialog = await openDialog(canvasElement)

  await userEvent.type(dialog.getByRole('textbox', { name: 'What changed?' }), note)

  const confirm = dialog.getByRole('button', { name: /^Publish Version/ })

  await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'false'))
  await userEvent.click(confirm)

  return confirm
}

const meta = preview.meta({
  title: 'Mappings/PublishDraft',
  component: DraftHeader,
  parameters: { layout: 'fullscreen' },
  args: { id: changed.id },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  beforeEach({ msw }) {
    publishRequests.length = 0
    msw.use(...createHandlers(apiUrl))
  },
})

export const UnpublishedChanges = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText('Unpublished changes since Version 3')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled()
  },
})

export const KeyboardFocus = meta.story({
  async play({ canvas }) {
    const publish = await canvas.findByRole('button', { name: 'Publish' })

    await userEvent.tab()
    await expect(publish).toHaveFocus()
    // The button transitions every property, so the outline can still be growing right after the Tab.
    await waitFor(async () => {
      const style = getComputedStyle(publish)

      await expect(style.outlineStyle).toBe('solid')
      await expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
    })
  },
})

export const NoChanges = meta.story({
  args: { id: unchanged.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No changes since Version 3')).toBeVisible()

    const publish = canvas.getByRole('button', { name: 'Publish' })

    await expect(publish).toBeDisabled()
    await expect(publish).toHaveAccessibleDescription('No changes since Version 3')
  },
})

export const NeverPublished = meta.story({
  args: { id: neverPublished.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('Never published')).toBeVisible()

    const dialog = await openDialog(canvasElement)

    await expect(page(canvasElement).getByRole('dialog')).toHaveAccessibleName('Publish Version 1?')
    await expect(dialog.getByText(/^No partner uses this Mapping yet\./)).toBeVisible()
  },
})

export const Confirm = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)
    const popup = page(canvasElement).getByRole('dialog')

    await expect(popup).toHaveAccessibleName('Publish Version 4?')
    await expect(popup).toHaveAccessibleDescription(/^Your unpublished changes become Version 4\./)

    const field = dialog.getByRole('textbox', { name: 'What changed?' })

    await expect(field).toHaveFocus()
    await expect(field).toHaveAccessibleDescription(
      `Shown in the version history. Up to ${maxChangeNoteLength} characters.`,
    )

    const flowGroup = await dialog.findByRole('group', { name: 'Document routes' })

    await expect(flowGroup).toBeVisible()

    for (const checkbox of within(flowGroup).getAllByRole('checkbox')) {
      await expect(checkbox).not.toBeChecked()
    }
  },
})

export const NoRoutes = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(unusedVersions))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)

    await expect(
      await dialog.findByText(
        'No partner uses this Mapping yet. Publishing changes nothing for your partners.',
      ),
    ).toBeVisible()
    await expect(dialog.queryByRole('checkbox')).toBeNull()
  },
})

export const SeveralRoutes = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)

    const elbtalFlow = await dialog.findByRole('checkbox', {
      name: 'Move Orders by SFTP (Elbtal Warenhaus KG) to Version 4',
    })

    await expect(elbtalFlow).toHaveAccessibleDescription('Uses Version 2 now.')
    await expect(
      dialog.getByRole('checkbox', { name: 'Move Orders by AS2 (Hansemarkt GmbH) to Version 4' }),
    ).toHaveAccessibleDescription('Uses Version 3 now.')
    await expect(
      dialog.getByText(
        'Orders by mail (Alpenfrisch AG), Orders by SFTP (Elbtal Warenhaus KG), and Orders by AS2 (Hansemarkt GmbH) keep their versions until you move them.',
      ),
    ).toBeVisible()

    await userEvent.click(elbtalFlow)
    await expect(elbtalFlow).toBeChecked()
    await expect(
      dialog.getByText(
        'Orders by mail (Alpenfrisch AG) and Orders by AS2 (Hansemarkt GmbH) keep their versions until you move them.',
      ),
    ).toBeVisible()

    await userEvent.type(dialog.getByRole('textbox', { name: 'What changed?' }), `  ${note}  `)
    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))

    await expectToast(canvasElement, 'Published as Version 4. 1 document route moved to it.')
    await expect(publishRequests).toEqual([{ changeNote: note, moveFlowIds: [elbtal.id] }])
  },
})

export const NothingMovesUnlessChosen = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvasElement }) {
    await confirmPublish(canvasElement)

    await expectToast(canvasElement, 'Published as Version 4.')
    await expect(publishRequests).toEqual([{ changeNote: note, moveFlowIds: [] }])
  },
})

export const ManyRoutes = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(manyFlows))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)
    const checkboxes = await dialog.findAllByRole('checkbox')

    await expect(checkboxes).toHaveLength(60)
    await expect(
      dialog.getByText('60 document routes keep their versions until you move them.'),
    ).toBeInTheDocument()
    await expect(
      page(canvasElement).getByRole('dialog').getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(window.innerHeight)
    await expect(dialog.getByRole('button', { name: 'Publish Version 4' })).toBeVisible()

    const last = checkboxes.at(-1)!

    last.focus()
    await userEvent.keyboard(' ')
    await expect(last).toBeChecked()
    await expect(
      dialog.getByText('59 document routes keep their versions until you move them.'),
    ).toBeInTheDocument()

    await userEvent.type(dialog.getByRole('textbox', { name: 'What changed?' }), note)
    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))

    await waitFor(() => expect(publishRequests).toHaveLength(1))
    await expect(publishRequests[0]!.moveFlowIds).toHaveLength(1)
  },
})

export const RoutesUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath, () => new HttpResponse(null, { status: 500 })),
      ...recordPublish(severalFlows),
    )
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)

    await expect(
      await dialog.findByText(
        'The document routes could not be loaded. Publishing now moves none of them.',
      ),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Load the document routes again' }),
    ).toBeVisible()

    await userEvent.type(dialog.getByRole('textbox', { name: 'What changed?' }), note)
    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))

    await waitFor(() => expect(publishRequests).toEqual([{ changeNote: note, moveFlowIds: [] }]))
  },
})

export const RoutesLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(versionsPath, async () => {
        await delay('infinite')
      }),
      publishHandler(severalFlows),
    )
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)
    const loading = 'Loading the document routes. You can publish once they are shown.'

    await expect(dialog.getByRole('status')).toHaveTextContent(loading)
    await expect(dialog.queryByRole('checkbox')).toBeNull()

    const confirm = dialog.getByRole('button', { name: 'Publish Version 4' })

    await expect(confirm).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm).toHaveAccessibleDescription(loading)

    await userEvent.type(dialog.getByRole('textbox', { name: 'What changed?' }), note)
    await userEvent.click(confirm)
    await expect(publishRequests).toEqual([])
  },
})

const elbtalMoved = versionEntries(
  changed,
  new Map([
    [3, [hansemarkt, elbtal]],
    [1, [alpenfrisch]],
  ]),
)

let releaseVersions = () => {}

export const RoutesRefreshedOnOpen = meta.story({
  beforeEach({ msw }) {
    let calls = 0

    msw.use(
      http.get(versionsPath, async () => {
        calls += 1

        if (calls === 1) {
          return HttpResponse.json(severalFlows)
        }

        await new Promise<void>((resolve) => {
          releaseVersions = resolve
        })

        return HttpResponse.json(elbtalMoved)
      }),
      publishHandler(severalFlows),
    )
  },
  async play({ canvasElement }) {
    const first = await openDialog(canvasElement)
    const elbtalName = 'Move Orders by SFTP (Elbtal Warenhaus KG) to Version 4'

    await expect(
      await first.findByRole('checkbox', { name: elbtalName }),
    ).toHaveAccessibleDescription('Uses Version 2 now.')
    await userEvent.click(first.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())

    const second = await openDialog(canvasElement)

    await expect(second.queryByRole('checkbox')).toBeNull()
    await expect(second.getByRole('button', { name: 'Publish Version 4' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    releaseVersions()

    await expect(
      await second.findByRole('checkbox', { name: elbtalName }),
    ).toHaveAccessibleDescription('Uses Version 3 now.')
  },
})

export const FourRoutes = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...recordPublish(
        versionEntries(
          changed,
          new Map([
            [3, [hansemarkt, flow('Orders by AS2', 'Nordwind Handel')]],
            [2, [elbtal]],
            [1, [alpenfrisch]],
          ]),
        ),
      ),
    )
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)

    await expect(
      await dialog.findByText('4 document routes keep their versions until you move them.'),
    ).toBeVisible()

    await userEvent.click(
      dialog.getByRole('checkbox', {
        name: 'Move Orders by AS2 (Nordwind Handel) to Version 4',
      }),
    )
    await expect(
      dialog.getByText(
        'Orders by mail (Alpenfrisch AG), Orders by SFTP (Elbtal Warenhaus KG), and Orders by AS2 (Hansemarkt GmbH) keep their versions until you move them.',
      ),
    ).toBeVisible()
  },
})

export const NoteMissing = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)
    const field = dialog.getByRole('textbox', { name: 'What changed?' })

    await userEvent.type(field, '   ')
    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))

    await expect(field).toHaveFocus()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(
      /Describe what changed, so the version history shows it\.$/,
    )
    await expect(publishRequests).toEqual([])

    await userEvent.type(field, note)
    await expect(field).toHaveAttribute('aria-invalid', 'false')
  },
})

export const NoteTooLong = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)
    const field = dialog.getByRole('textbox', { name: 'What changed?' })

    await userEvent.click(field)
    await userEvent.paste('a'.repeat(maxChangeNoteLength + 12))

    await expect(
      dialog.getByText(`Shorten the note to ${maxChangeNoteLength} characters. It has 512 now.`),
    ).toBeVisible()

    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))
    await expect(field).toHaveFocus()
    await expect(publishRequests).toEqual([])
  },
})

export const Publishing = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(publishPath, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvasElement }) {
    const confirm = await confirmPublish(canvasElement)

    await expect(
      await page(canvasElement).findByRole('button', { name: 'Publishing…' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm).toHaveFocus()
  },
})

export const Published = meta.story({
  args: { id: publishable.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: [publishable] }))
  },
  async play({ canvas, canvasElement }) {
    const title = await canvas.findByRole('heading', { level: 1 })
    const top = title.getBoundingClientRect().top

    await confirmPublish(canvasElement)
    await expectToast(canvasElement, 'Published as Version 5.')
    await expect(title.getBoundingClientRect().top).toBe(top)

    const state = canvas.getByText('No changes since Version 5')

    await expect(state).toBeVisible()
    await waitFor(() => expect(state.closest('[tabindex="-1"]')).toHaveFocus())
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeDisabled()
  },
})

export const NothingToPublish = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(publishPath, () =>
        HttpResponse.json(
          { message: 'The Draft has no changes since its latest version.' },
          { status: 409 },
        ),
      ),
    )
  },
  async play({ canvasElement }) {
    await confirmPublish(canvasElement)

    const alert = await page(canvasElement).findByText(/there is nothing to publish/)

    await waitFor(() => expect(alert).toBeVisible())
  },
})

export const Incomplete = meta.story({
  args: { id: incompleteDraftId },
  async play({ canvasElement }) {
    const confirm = await confirmPublish(canvasElement)

    await expect(
      await page(canvasElement).findByText(/every link and Transform must be complete/),
    ).toBeVisible()
    await expect(confirm).toHaveFocus()
  },
})

export const Failed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(publishPath, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvasElement }) {
    const confirm = await confirmPublish(canvasElement)

    await expect(
      await page(canvasElement).findByText('The Draft could not be published. Try again.'),
    ).toBeVisible()
    await expect(confirm).toHaveFocus()
    await expect(confirm).toBeEnabled()
    await expect(page(canvasElement).getByRole('textbox', { name: 'What changed?' })).toHaveValue(
      note,
    )
  },
})

export const ReviewOpen = meta.story({
  args: { id: inReview.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: [inReview] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Accept the draft before publishing.')).toBeVisible()

    const publish = canvas.getByRole('button', { name: 'Publish' })

    await expect(publish).toBeDisabled()
    await expect(publish).toHaveAccessibleDescription(
      'Unpublished changes since Version 4 Accept the draft before publishing.',
    )
  },
})

export const ReviewOpenMeanwhile = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(publishPath, () =>
        HttpResponse.json(
          { message: 'The AI review of the Draft is still open.' },
          { status: aiReviewOpenStatus },
        ),
      ),
    )
  },
  async play({ canvasElement }) {
    const confirm = await confirmPublish(canvasElement)

    await expect(
      await page(canvasElement).findByText(
        'The Draft cannot be published while its AI review is open. Accept the draft first, then publish.',
      ),
    ).toHaveAttribute('role', 'alert')
    await expect(confirm).toHaveFocus()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))
  },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByText('Unveröffentlichte Änderungen seit Version 3'),
    ).toBeVisible()

    const dialog = await openDialog(canvasElement, 'Veröffentlichen')

    await expect(page(canvasElement).getByRole('dialog')).toHaveAccessibleName(
      'Version 4 veröffentlichen?',
    )
    await expect(dialog.getByRole('textbox', { name: 'Was hat sich geändert?' })).toHaveFocus()
    await expect(
      await dialog.findByRole('checkbox', {
        name: 'Orders by SFTP (Elbtal Warenhaus KG) auf Version 4 umstellen',
      }),
    ).toHaveAccessibleDescription('Nutzt jetzt Version 2.')

    await userEvent.click(dialog.getByRole('button', { name: 'Version 4 veröffentlichen' }))
    await expect(
      dialog.getByText(
        'Beschreiben Sie, was sich geändert hat, damit die Versionshistorie es zeigt.',
      ),
    ).toBeVisible()
    await expect(publishRequests).toEqual([])
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPublish(severalFlows))

    return darkMode()
  },
  async play({ canvasElement }) {
    const dialog = await openDialog(canvasElement)

    await userEvent.click(
      await dialog.findByRole('checkbox', {
        name: 'Move Orders by AS2 (Hansemarkt GmbH) to Version 4',
      }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Publish Version 4' }))
    await expect(
      dialog.getByText('Describe what changed, so the version history shows it.'),
    ).toBeVisible()
  },
})
