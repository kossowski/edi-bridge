import { useQuery } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DraftStateLabel, PublishDraft } from '@/components/mappings/draft-status'
import { apiUrl } from '@/lib/api/config'
import { mappingDraftQuery } from '@/lib/api/queries'
import messagesDe from '@/messages/de.json'
import { publishMappingDraftEndpoint, transformIssues } from '@edi-bridge/contracts'
import { createHandlers, seedMappingDrafts } from '@edi-bridge/mocks'

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

const incomplete = seedMappingDrafts.find(
  (draft) =>
    draft.unpublishedChanges &&
    Object.values(transformIssues(draft)).some((issues) => issues.length > 0),
)!

const publishPath = `${apiUrl}${publishMappingDraftEndpoint.path}`

function DraftHeader({ id }: { id: string }) {
  const { data: draft } = useQuery(mappingDraftQuery(id))

  return draft ? (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{draft.name}</h1>
      <DraftStateLabel draft={draft} />
      <div className="ms-auto">
        <PublishDraft draft={draft} />
      </div>
    </div>
  ) : null
}

function dialog(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

async function confirmPublish(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)

  await userEvent.click(await canvas.findByRole('button', { name: 'Publish' }))

  const confirm = await dialog(canvasElement).findByRole('button', { name: /^Publish Version/ })

  await userEvent.click(confirm)
}

const meta = preview.meta({
  title: 'Mappings/DraftStatus',
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

export const NoChanges = meta.story({
  args: { id: unchanged.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No changes since Version 3')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeDisabled()
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
    await confirmPublish(canvasElement)
    await expect(
      await dialog(canvasElement).findByRole('button', { name: 'Publishing…' }),
    ).toBeDisabled()
  },
})

export const Published = meta.story({
  args: { id: publishable.id },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: [publishable] }))
  },
  async play({ canvas, canvasElement }) {
    await confirmPublish(canvasElement)
    await expect(await canvas.findByText('Published as Version 5.')).toBeVisible()
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
    await expect(
      await dialog(canvasElement).findByText(/there is nothing to publish/),
    ).toBeVisible()
  },
})

export const Incomplete = meta.story({
  args: { id: incomplete.id },
  async play({ canvasElement }) {
    await confirmPublish(canvasElement)
    await expect(
      await dialog(canvasElement).findByText(/every link and Transform must be complete/),
    ).toBeVisible()
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
    await confirmPublish(canvasElement)
    await expect(
      await dialog(canvasElement).findByText('The Draft could not be published. Try again.'),
    ).toBeVisible()
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
