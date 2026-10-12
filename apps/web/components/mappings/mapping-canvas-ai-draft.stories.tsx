import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { ReactRenderer, StoryContext } from '@storybook/nextjs-vite'
import type { BeforeEach } from 'storybook/internal/csf'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import { page, seeded } from '@/components/mappings/mapping-canvas-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  aiBudgetExhaustedStatus,
  aiReviewOpenStatus,
  requestAiDraftEndpoint,
} from '@edi-bridge/contracts'
import {
  type AiDraftState,
  aiProposalFor,
  createHandlers,
  type MappingDraftRecord,
  seedDocumentStructures,
  seedMappingSamples,
  withAiProposal,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const withoutLinks = seeded('Rheinkauf: ERP JSON to INVOIC')

const sample = seedMappingSamples.find(({ mappingId }) => mappingId === withoutLinks.id)!

const inReview = withAiProposal(
  withoutLinks,
  sample.id,
  aiProposalFor(withoutLinks, seedDocumentStructures),
)

const requestPath = `${apiUrl}${requestAiDraftEndpoint.path}`

function aiDraft(
  state: AiDraftState,
  {
    mappingDrafts,
    stepDelayMs = 20,
  }: {
    mappingDrafts?: ReadonlyArray<MappingDraftRecord>
    stepDelayMs?: number
  } = {},
): BeforeEach<ReactRenderer> {
  return ({ msw }: StoryContext) => {
    const streams = new AbortController()

    msw.use(
      ...createHandlers(apiUrl, {
        aiDraft: { state, stepDelayMs, signal: streams.signal },
        ...(mappingDrafts && { mappingDrafts }),
      }),
    )

    return () => streams.abort()
  }
}

async function openAiDraft(canvasElement: HTMLElement, action: string | RegExp = 'Draft with AI') {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: action }))

  const dialog = await page(canvasElement).findByRole('dialog', { name: 'Draft with AI' })

  await waitFor(() => expect(dialog).toBeVisible())

  return within(dialog)
}

async function startAiDraft(canvasElement: HTMLElement, budgetText = /tokens left today/) {
  const dialog = await openAiDraft(canvasElement)

  await expect(await dialog.findByRole('combobox', { name: 'Sample Document' })).toBeVisible()
  await expect(await dialog.findByText(budgetText)).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'Start the AI draft' }))

  return dialog
}

type DialogQueries = Awaited<ReturnType<typeof openAiDraft>>

async function findProgress(dialog: DialogQueries) {
  return within(await dialog.findByRole('list', { name: 'Progress' }))
}

async function findOutcome(dialog: DialogQueries, title: string) {
  const heading = await dialog.findByRole('heading', { name: title }, { timeout: 5000 })

  await waitFor(() => expect(heading).toHaveFocus())

  return heading
}

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/AiDraft',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: withoutLinks.id },
  decorators: [
    (Story) => (
      <div className="flex min-h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach: aiDraft('proposing'),
})

export const Idle = meta.story({
  async play({ canvasElement }) {
    const dialog = await openAiDraft(canvasElement)

    await expect(
      await dialog.findByRole('combobox', { name: 'Sample Document' }),
    ).toHaveTextContent(sample.name)
    await expect(dialog.getByText('Document Structure', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Message Type INVOIC')).toBeVisible()
    await expect(await dialog.findByText('151,650 of 200,000 tokens left today.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start the AI draft' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
})

export const InProgress = meta.story({
  beforeEach: aiDraft('loading'),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await expect(dialog.getByRole('button', { name: 'Close' })).toHaveFocus()
    await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible()

    const current = await (await findProgress(dialog)).findByText(/^Looking up segments:/)

    await expect(current.closest('li')).toHaveAttribute('data-state', 'current')
    await expect(dialog.getByText('Reading the Sample Document').closest('li')).toHaveAttribute(
      'data-state',
      'done',
    )
    await expect(dialog.getByRole('status')).toHaveTextContent(/^Looking up segments:/)
    await expect(
      dialog.getByText('The AI draft keeps going when you close this dialog. Stop ends it.'),
    ).toBeVisible()
    await expect(canvas.getByText('No links yet')).toBeVisible()
  },
})

export const CloseKeepsDraftGoing = meta.story({
  beforeEach: aiDraft('proposing', { stepDelayMs: 400 }),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await (await findProgress(dialog)).findByText('Reading the Sample Document')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())

    await expect(canvas.getByRole('button', { name: /^AI drafting: / })).toHaveFocus()

    const reopened = await openAiDraft(canvasElement, /^AI drafting: /)

    await expect(await reopened.findByRole('list', { name: 'Progress' })).toBeVisible()
    await waitFor(() => expect(reopened.getByRole('button', { name: 'Close' })).toHaveFocus())
    await userEvent.click(reopened.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())

    const announcement = await canvas.findByText(
      /passed the check against the Sample Document/,
      {},
      { timeout: 6000 },
    )

    await expect(announcement).toHaveAttribute('role', 'status')
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0),
    )

    const ended = await openAiDraft(canvasElement, 'AI draft ended')

    await findOutcome(ended, 'Links added to the canvas')
    await userEvent.click(ended.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Draft with AI' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  },
})

export const StopEndsDraft = meta.story({
  beforeEach: aiDraft('loading'),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await (await findProgress(dialog)).findByText(/^Looking up segments:/)
    await userEvent.click(dialog.getByRole('button', { name: 'Stop' }))
    await findOutcome(dialog, 'AI draft stopped')
    await expect(dialog.getByText(/^Looking up segments:/).closest('li')).toHaveAttribute(
      'data-state',
      'stopped',
    )
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.getByText('No links yet')).toBeVisible()

    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).toBeVisible()

    const reopened = await openAiDraft(canvasElement)

    await expect(reopened.getByRole('button', { name: 'Start the AI draft' })).toBeVisible()
  },
})

export const Drafted = meta.story({
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    const outcome = await findOutcome(dialog, 'Links added to the canvas')

    await expect(dialog.getByText('Round 2')).toBeVisible()
    await expect(dialog.getByText('Fixing 2 errors')).toBeVisible()
    await expect(
      within(outcome.parentElement!).getByText(/passed the check against the Sample Document/),
    ).toBeVisible()
    await expect(canvas.queryByText('No links yet')).toBeNull()
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0),
    )

    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))

    const action = await canvas.findByRole('button', { name: 'Draft with AI' })

    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toHaveAccessibleDescription(/AI proposals? to review$/)
  },
})

export const EmptyProposal = meta.story({
  beforeEach: aiDraft('empty'),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'The AI found no links')
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.getByText('No links yet')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
})

export const CheckFailed = meta.story({
  beforeEach: aiDraft('error'),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    const outcome = await findOutcome(dialog, 'The links did not pass the check')

    await expect(dialog.getByText('Round 3')).toBeVisible()
    await expect(within(outcome.parentElement!).getByText(/within 3 rounds/)).toBeVisible()
    await expect(dialog.getByText('Fixing 1 error').closest('li')).toHaveAttribute(
      'data-state',
      'stopped',
    )
    await expect(canvas.getByText('No links yet')).toBeVisible()

    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(dialog.getByRole('combobox', { name: 'Sample Document' })).toHaveFocus(),
    )
  },
})

export const Unavailable = meta.story({
  beforeEach: aiDraft('unavailable'),
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'The AI is unavailable')
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const BudgetExhausted = meta.story({
  beforeEach: aiDraft('budgetExhausted'),
  async play({ canvasElement }) {
    const dialog = await openAiDraft(canvasElement)
    const notice = "Today's AI token budget is used up. AI drafts are available again tomorrow."

    await expect(await dialog.findByText(notice)).toBeVisible()

    const start = dialog.getByRole('button', { name: 'Start the AI draft' })

    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await expect(start).toHaveAccessibleDescription(notice)
  },
})

export const BudgetExhaustedMidRun = meta.story({
  beforeEach: aiDraft('budgetExhaustedMidRun'),
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'AI token budget used up')
    await expect(dialog.queryByRole('button', { name: 'Try again' })).toBeNull()
    await expect(dialog.getByText('Fixing 2 errors').closest('li')).toHaveAttribute(
      'data-state',
      'stopped',
    )
  },
})

export const BudgetUsedUpMeanwhile = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(requestPath, () =>
        HttpResponse.json(
          {
            code: 'aiBudgetExhausted',
            message: 'The daily AI budget of the Workspace is used up.',
            budget: {
              dailyLimit: 200_000,
              usedToday: 200_000,
              resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
          },
          { status: aiBudgetExhaustedStatus },
        ),
      ),
    )
  },
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'AI token budget used up')
    await expect(dialog.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
})

export const LargeVolume = meta.story({
  beforeEach: aiDraft('large'),
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'Links added to the canvas')
    await expect(dialog.getByText(/and \d+ more$/)).toBeVisible()
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(20),
    )
  },
})

export const ReviewOpen = meta.story({
  args: { id: inReview.id },
  beforeEach: aiDraft('proposing', { mappingDrafts: [inReview] }),
  async play({ canvas }) {
    const action = await canvas.findByRole('button', { name: 'Draft with AI' })

    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toHaveAccessibleDescription(/^AI review open \d+ AI proposals to review$/)
  },
})

export const ReviewOpenMeanwhile = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(requestPath, () =>
        HttpResponse.json(
          { message: 'The AI review of the Draft is still open.' },
          { status: aiReviewOpenStatus },
        ),
      ),
    )
  },
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'AI review still open')
    await expect(dialog.queryByRole('button', { name: 'Try again' })).toBeNull()
  },
})

export const SmallScreen = meta.story({
  globals: { viewport: { value: 'tablet', isRotated: false } },
  async play({ canvas }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Draft with AI' })).toBeNull()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        await canvas.findByRole('heading', { level: 1, name: withoutLinks.name }),
      ).toBeInTheDocument()
      await expect(canvas.queryByRole('button', { name: 'Draft with AI' })).toBeNull()
      await expect(canvas.queryByText(/\bAI\b/)).toBeNull()
    },
  }),
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvasElement }) {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Mit KI entwerfen' }),
    )

    const dialog = within(
      await page(canvasElement).findByRole('dialog', { name: 'Mit KI entwerfen' }),
    )

    const budget = await dialog.findByText('Heute noch 151.650 von 200.000 Tokens übrig.')

    await waitFor(() => expect(budget).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'KI-Entwurf starten' }))
    await findOutcome(dialog, 'Verknüpfungen zur Zeichenfläche hinzugefügt')
    await expect(dialog.getByText('Runde 2')).toBeVisible()
    await expect(dialog.getByText('2 Fehler werden behoben')).toBeVisible()
  },
})

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'Links added to the canvas')
  },
})

export const DarkCheckFailed = meta.story({
  beforeEach: [aiDraft('error'), darkMode],
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'The links did not pass the check')
  },
})
