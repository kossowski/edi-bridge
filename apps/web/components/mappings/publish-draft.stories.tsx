import { useQuery } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { useId } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AppPage } from '@/components/app-page'
import { AiReviewState } from '@/components/mappings/ai-review-state'
import { DraftStateLabel, PublishDraft } from '@/components/mappings/publish-draft'
import { apiUrl } from '@/lib/api/config'
import { mappingDraftQuery } from '@/lib/api/queries'
import messagesDe from '@/messages/de.json'
import { aiReviewOpenStatus, publishMappingDraftEndpoint } from '@edi-bridge/contracts'
import {
  aiProposalFor,
  createHandlers,
  incompleteDraftId,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  withAiProposal,
} from '@edi-bridge/mocks'

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

function DraftHeader({ id }: { id: string }) {
  const { data: draft } = useQuery(mappingDraftQuery(id))
  const stateId = useId()
  const summaryId = useId()
  const publishHintId = useId()

  return draft ? (
    <AppPage
      actions={<PublishDraft draft={draft} reviewHintId={publishHintId} stateId={stateId} />}
      meta={<DraftStateLabel id={stateId} draft={draft} />}
      title={draft.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AiReviewState draft={draft} publishHintId={publishHintId} summaryId={summaryId} />
      </div>
    </AppPage>
  ) : null
}

function dialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

async function confirmPublish(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)

  await userEvent.click(await canvas.findByRole('button', { name: 'Publish' }))

  const confirmation = await dialog(canvasElement).findByRole('dialog')

  await waitFor(() => expect(confirmation).toBeVisible())

  const confirm = within(confirmation).getByRole('button', { name: /^Publish Version/ })

  await userEvent.click(confirm)

  return confirm
}

const meta = preview.meta({
  title: 'Mappings/PublishDraft',
  component: DraftHeader,
  parameters: { layout: 'fullscreen' },
  args: { id: changed.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const UnpublishedChanges = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByText('Unpublished changes since Version 3')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled()
    await expect(canvas.getByRole('link', { name: 'Mapping Versions' })).toHaveAttribute(
      'href',
      `/mappings/${changed.id}/versions`,
    )
  },
})

export const KeyboardFocus = meta.story({
  async play({ canvas }) {
    const link = await canvas.findByRole('link', { name: 'Mapping Versions' })

    await userEvent.tab()
    await expect(link).toHaveFocus()
    await expect(getComputedStyle(link).boxShadow).not.toBe('none')
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
  async play({ canvas }) {
    await expect(await canvas.findByText('Never published')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled()
  },
})

export const Confirm = meta.story({
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Publish' }))

    const confirmation = await dialog(canvasElement).findByRole('dialog', {
      name: 'Publish the Draft as Version 4?',
    })

    await waitFor(() => expect(confirmation).toBeVisible())
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
      await dialog(canvasElement).findByRole('button', { name: 'Publishing…' }),
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
    await expect(await canvas.findByText('Published as Version 5.')).toBeVisible()
    await expect(title.getBoundingClientRect().top).toBe(top)
    await expect(canvas.getByText('No changes since Version 5')).toBeVisible()
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

    const alert = await dialog(canvasElement).findByText(/there is nothing to publish/)

    await waitFor(() => expect(alert).toBeVisible())
  },
})

export const Incomplete = meta.story({
  args: { id: incompleteDraftId },
  async play({ canvasElement }) {
    const confirm = await confirmPublish(canvasElement)

    await expect(
      await dialog(canvasElement).findByText(/every link and Transform must be complete/),
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
      await dialog(canvasElement).findByText('The Draft could not be published. Try again.'),
    ).toBeVisible()
    await expect(confirm).toHaveFocus()
    await expect(confirm).toBeEnabled()
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
      await dialog(canvasElement).findByText(
        'The Draft cannot be published while its AI review is open. Accept the draft first, then publish.',
      ),
    ).toHaveAttribute('role', 'alert')
    await expect(confirm).toHaveFocus()
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
      await canvas.findByText('Unveröffentlichte Änderungen seit Version 3'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Veröffentlichen' })).toBeEnabled()
  },
})

export const Dark = meta.story({
  args: { id: publishable.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: [publishable] }))
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvasElement }) {
    await confirmPublish(canvasElement)
    await expect(await within(canvasElement).findByText('Published as Version 5.')).toBeVisible()
  },
})
