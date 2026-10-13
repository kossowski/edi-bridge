import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { ReactRenderer, StoryContext } from '@storybook/nextjs-vite'
import type { ReactElement } from 'react'
import type { BeforeEach } from 'storybook/internal/csf'

import { aiDraftStartQuery } from '@/components/mappings/ai-draft-run'
import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  expectSavedLinkCount,
  findSheet,
  page,
  seeded,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  aiBudgetEndpoint,
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

function countAiDraftRequests(): BeforeEach<ReactRenderer> & { count: () => number } {
  let requests = 0

  const counting: BeforeEach<ReactRenderer> = ({ msw }: StoryContext) => {
    requests = 0
    msw.use(
      http.post(requestPath, () => {
        requests += 1
      }),
    )
  }

  return Object.assign(counting, { count: () => requests })
}

const startLink = (id: string) => ({
  args: { id, aiDraftRequested: true },
  parameters: {
    nextjs: { navigation: { pathname: `/mappings/${id}`, query: aiDraftStartQuery } },
  },
})

async function expectStartLinkRemoved(id: string) {
  await waitFor(() =>
    expect(getRouter().replace).toHaveBeenCalledWith(`/mappings/${id}`, { scroll: false }),
  )
}

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

  return findSheet(canvasElement, 'Draft with AI')
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
    await expect(dialog.getByText('Data format', { exact: false })).toBeVisible()
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
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await waitFor(() => expect(dialog.getByRole('button', { name: 'Stop' })).toHaveFocus())
    await expect(dialog.queryByRole('button', { name: /^Close/ })).toBeNull()

    const current = await (await findProgress(dialog)).findByText(/^Looking up segments:/)

    await expect(current.closest('li')).toHaveAttribute('data-state', 'current')
    await expect(dialog.getByText('Reading the Sample Document').closest('li')).toHaveAttribute(
      'data-state',
      'done',
    )
    await expect(dialog.getByRole('status')).toHaveTextContent(/^Looking up segments:/)
    await expect(
      dialog.getByText('This dialog stays open until the AI draft is done. Stop ends it early.'),
    ).toBeVisible()
    await expectSavedLinkCount(withoutLinks.id, 0)
  },
})

export const RunningDialogStaysOpen = meta.story({
  beforeEach: aiDraft('proposing', { stepDelayMs: 400 }),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await (await findProgress(dialog)).findByText('Reading the Sample Document')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(
      canvasElement.ownerDocument.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!,
    )
    await expect(page(canvasElement).getByRole('dialog', { name: 'Draft with AI' })).toBeVisible()
    await expect(dialog.queryByRole('button', { name: /^Close/ })).toBeNull()
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Stop' })).toHaveFocus())

    await findOutcome(dialog, 'Links added to the canvas')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.queryByRole('button', { name: 'Draft with AI' })).toBeNull()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /need attention$/ })).toHaveFocus(),
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
    await expectSavedLinkCount(withoutLinks.id, 0)

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
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0),
    )

    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.queryByRole('button', { name: 'Draft with AI' })).toBeNull()
  },
})

export const EmptyProposal = meta.story({
  beforeEach: aiDraft('empty'),
  async play({ canvas, canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'The AI found no links')
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectSavedLinkCount(withoutLinks.id, 0)
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
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    const outcome = await findOutcome(dialog, 'The links did not pass the check')

    await expect(dialog.getByText('Round 3')).toBeVisible()
    await expect(within(outcome.parentElement!).getByText(/within 3 rounds/)).toBeVisible()
    await expect(dialog.getByText('Fixing 1 error').closest('li')).toHaveAttribute(
      'data-state',
      'stopped',
    )
    await expectSavedLinkCount(withoutLinks.id, 0)

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
    await expect(await canvas.findByRole('button', { name: /need attention$/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Draft with AI' })).toBeNull()
  },
})

const startLinkRequests = countAiDraftRequests()

export const StartLink = meta.story({
  ...startLink(withoutLinks.id),
  beforeEach: [aiDraft('loading'), startLinkRequests],
  async play({ canvas, canvasElement }) {
    const dialog = await findSheet(canvasElement, 'Draft with AI')

    await expectStartLinkRemoved(withoutLinks.id)
    await (await findProgress(dialog)).findByText(/^Looking up segments:/)
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Stop' })).toHaveFocus())
    await userEvent.click(dialog.getByRole('button', { name: 'Stop' }))
    await findOutcome(dialog, 'AI draft stopped')
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).toHaveFocus()
    await expect(startLinkRequests.count()).toBe(1)
  },
})

const manualStartRequests = countAiDraftRequests()

function holdBudget(): BeforeEach<ReactRenderer> & { release: () => void } {
  let release = () => {}

  const holding: BeforeEach<ReactRenderer> = ({ msw }: StoryContext) => {
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    msw.use(
      http.get(`${apiUrl}${aiBudgetEndpoint.path}`, async () => {
        await held
      }),
    )
  }

  return Object.assign(holding, { release: () => release() })
}

const heldBudget = holdBudget()

export const StartLinkStartedByHand = meta.story({
  ...startLink(withoutLinks.id),
  beforeEach: [aiDraft('loading'), manualStartRequests, heldBudget],
  async play({ canvasElement }) {
    const dialog = await findSheet(canvasElement, 'Draft with AI')

    await dialog.findByRole('combobox', { name: 'Sample Document' })
    await userEvent.click(dialog.getByRole('button', { name: 'Start the AI draft' }))
    await (await findProgress(dialog)).findByText(/^Looking up segments:/)
    heldBudget.release()
    await userEvent.click(dialog.getByRole('button', { name: 'Stop' }))
    await findOutcome(dialog, 'AI draft stopped')
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }))
    await expect(await dialog.findByText(/tokens left today/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start the AI draft' })).toBeVisible()
    await expect(manualStartRequests.count()).toBe(1)
  },
})

export const StartLinkBudgetUsedUp = meta.story({
  ...startLink(withoutLinks.id),
  beforeEach: [aiDraft('budgetExhausted'), startLinkRequests],
  async play({ canvasElement }) {
    const dialog = await findSheet(canvasElement, 'Draft with AI')

    await expect(
      await dialog.findByText(
        "Today's AI token budget is used up. AI drafts are available again tomorrow.",
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Start the AI draft' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(startLinkRequests.count()).toBe(0)
  },
})

export const StartLinkDuringReview = meta.story({
  ...startLink(inReview.id),
  beforeEach: [aiDraft('proposing', { mappingDrafts: [inReview] }), startLinkRequests],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('button', { name: /need attention$/ })).toBeVisible()
    await expectStartLinkRemoved(inReview.id)
    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()
    await expect(startLinkRequests.count()).toBe(0)
  },
})

export const StartLinkSmallScreen = meta.story({
  ...startLink(withoutLinks.id),
  globals: { viewport: { value: 'tablet', isRotated: false } },
  beforeEach: [aiDraft('proposing'), startLinkRequests],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await expectStartLinkRemoved(withoutLinks.id)
    await expect(page(canvasElement).queryByRole('dialog')).toBeNull()
    await expect(startLinkRequests.count()).toBe(0)
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

export const StartLinkViewer = meta.story({
  ...startLink(withoutLinks.id),
  ...viewerStory({
    beforeEach: startLinkRequests,
    async play({ canvas, canvasElement }) {
      await expect(
        await canvas.findByRole('heading', { level: 1, name: withoutLinks.name }),
      ).toBeInTheDocument()
      await expectStartLinkRemoved(withoutLinks.id)
      await expect(page(canvasElement).queryByRole('dialog')).toBeNull()
      await expect(startLinkRequests.count()).toBe(0)
    },
  }),
})

function german(Story: () => ReactElement) {
  return (
    <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
      <Story />
    </NextIntlClientProvider>
  )
}

export const GermanRunning = meta.story({
  ...startLink(withoutLinks.id),
  decorators: [german],
  beforeEach: aiDraft('loading'),
  async play({ canvasElement }) {
    const dialog = await findSheet(canvasElement, 'Mit KI entwerfen')

    await expect(
      await dialog.findByText(
        'Dieser Dialog bleibt offen, bis der KI-Entwurf fertig ist. Stoppen beendet ihn vorzeitig.',
      ),
    ).toBeVisible()
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Stoppen' })).toHaveFocus())
    await expect(dialog.queryByRole('button', { name: 'Dialog schließen' })).toBeNull()
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
  async play({ canvasElement }) {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Mit KI entwerfen' }),
    )

    const dialog = await findSheet(canvasElement, 'Mit KI entwerfen')

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

export const DarkRunning = meta.story({
  ...startLink(withoutLinks.id),
  beforeEach: [aiDraft('loading'), darkMode],
  async play({ canvasElement }) {
    const dialog = await findSheet(canvasElement, 'Draft with AI')

    await (await findProgress(dialog)).findByText(/^Looking up segments:/)
    await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible()
  },
})

export const DarkCheckFailed = meta.story({
  beforeEach: [aiDraft('error'), darkMode],
  async play({ canvasElement }) {
    const dialog = await startAiDraft(canvasElement)

    await findOutcome(dialog, 'The links did not pass the check')
  },
})
