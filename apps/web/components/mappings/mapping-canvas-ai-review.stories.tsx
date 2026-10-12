import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  detailsPanel,
  openDetails,
  findSaveStatus,
  inReview,
  liveStatus,
  reviewing,
  transformNodeOf,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { acceptAiDraftEndpoint } from '@edi-bridge/contracts'

import preview from '../../.storybook/preview'

// Links drafted next to the Admin's own, with a Lookup Table among the Transforms.
const outbound = inReview('Alpenfrisch: ERP JSON to INVOIC')

const inbound = inReview('Rheinkauf: ORDERS to ERP JSON')

const fromScratch = inReview('Rheinkauf: ERP JSON to INVOIC')

const large = inReview('Bodensee: ERP JSON to INVOIC', 'large')

const proposedRow = /AI-proposed link$/

const proposedEdge = /, AI-proposed(, needs attention)?$/

const attentionEdge = /, needs attention$/

function aiMarks(canvasElement: HTMLElement) {
  return canvasElement.querySelectorAll('[data-ai-proposed]')
}

async function findSummary(canvasElement: HTMLElement) {
  return within(canvasElement).findByText(/AI proposals? to review$/)
}

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/AiReview',
  component: MappingCanvasScreen,
  parameters: { layout: 'fullscreen' },
  args: { id: outbound.id },
  decorators: [
    (Story) => (
      <div className="flex min-h-svh flex-col">
        <Story />
      </div>
    ),
  ],
  beforeEach: reviewing(outbound),
})

export const ReviewOpen = meta.story({
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('AI review open')).toBeVisible()
    await expect(await findSummary(canvasElement)).toHaveTextContent('19 AI proposals to review')

    const rows = await canvas.findAllByRole('button', { name: proposedRow })

    await expect(rows.length).toBeGreaterThan(0)
    await expect(canvas.getAllByRole('group', { name: proposedEdge }).length).toBeGreaterThan(
      rows.length - 1,
    )
    await expect(canvas.getAllByRole('group', { name: /^Link from/ }).length).toBeGreaterThan(
      canvas.getAllByRole('group', { name: proposedEdge }).length,
    )

    const lookup = transformNodeOf(canvasElement, 'Lookup Table 1')

    await expect(within(lookup).getByRole('group')).toHaveAttribute('data-ai-proposed', 'true')
    await expect(
      within(lookup).getByRole('button', { name: 'Lookup Table 1 AI-proposed Transform' }),
    ).toBeVisible()
    await expect(
      within(lookup).getByRole('button', { name: 'Reject the AI-proposed Lookup Table 1' }),
    ).toBeVisible()

    const publish = canvas.getByRole('button', { name: 'Publish' })

    await expect(publish).toBeDisabled()
    await expect(publish).toHaveAccessibleDescription(/Accept the draft before publishing\.$/)
    await expect(canvas.getByText('Accept the draft before publishing.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Accept draft' })).toBeVisible()
  },
})

// Only the proposed links the review asks about stand out, in amber and with their own dash.
export const AttentionMarks = meta.story({
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)

    const proposed = await canvas.findAllByRole('group', { name: proposedEdge })
    const attention = await canvas.findAllByRole('group', { name: attentionEdge })

    await expect(attention.length).toBeGreaterThan(0)
    await expect(attention.length).toBeLessThan(proposed.length)

    const strokeOf = (edge: HTMLElement) =>
      edge.querySelector<SVGPathElement>('.react-flow__edge-path')!.style

    for (const edge of attention) {
      await expect(strokeOf(edge).stroke).toBe('var(--ai-attention)')
      await expect(strokeOf(edge).strokeDasharray).not.toBe('6 3')
    }

    for (const edge of proposed.filter((own) => !attention.includes(own))) {
      await expect(strokeOf(edge).stroke).toBe('var(--ai-proposed)')
    }
  },
})

export const InboundWithLookupTable = meta.story({
  args: { id: inbound.id },
  beforeEach: reviewing(inbound),
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Lookup Table 1/ }))

    const panel = await detailsPanel(canvasElement)

    await expect(
      panel.getByRole('heading', { name: 'Lookup Table 1 AI-proposed Transform' }),
    ).toBeVisible()
    await expect(panel.getAllByText('AI-proposed').length).toBeGreaterThan(0)
    await expect(
      panel.getAllByRole('button', { name: /^Reject the AI-proposed link from/ }).length,
    ).toBeGreaterThan(0)

    const lookupTables = () => canvas.queryAllByRole('group', { name: /^Transform Lookup Table/ })
    const before = lookupTables().length

    await userEvent.click(panel.getByRole('button', { name: 'Reject Lookup Table 1' }))
    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('AI-proposed Lookup Table 1 rejected.'),
    )
    await expect(lookupTables()).toHaveLength(before - 1)
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
  },
})

export const RejectLink = meta.story({
  async play({ canvas, canvasElement }) {
    const summary = await findSummary(canvasElement)
    const [row] = await canvas.findAllByRole('button', { name: proposedRow })

    await userEvent.click(row!)

    const panel = await openDetails(canvasElement)

    await expect(panel.getByText('AI-proposed')).toBeVisible()

    const reject = panel.getByRole('button', { name: /^Reject the AI-proposed link from/ })
    const [, source, target] = /from (.+) to (.+)$/.exec(reject.getAttribute('aria-label')!)!

    await expect(reject).toHaveTextContent('Reject')
    await userEvent.click(reject)

    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent(
        `AI-proposed link from ${source} to ${target} rejected.`,
      ),
    )
    await expect(panel.getByText('This part has no links yet.')).toBeVisible()
    await expect(summary).toHaveTextContent('18 AI proposals to review')
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expect(summary).toHaveTextContent('18 AI proposals to review')
  },
})

export const EditTransform = meta.story({
  args: { id: fromScratch.id },
  beforeEach: reviewing(fromScratch),
  async play({ canvas, canvasElement }) {
    const summary = await findSummary(canvasElement)
    const before = Number(/\d+/.exec(summary.textContent)![0])

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Constant 1 AI-proposed Transform' }),
    )

    const panel = await detailsPanel(canvasElement)
    const value = panel.getByRole('textbox', { name: 'Value' })

    await userEvent.clear(value)
    await userEvent.type(value, '389')
    await userEvent.tab()

    await waitFor(() =>
      expect(liveStatus(canvasElement)).toHaveTextContent('Settings of Constant 1 saved.'),
    )
    await expect(canvas.getByRole('button', { name: 'Constant 1' })).toBeVisible()
    await expect(
      within(transformNodeOf(canvasElement, 'Constant 1')).getByRole('group'),
    ).not.toHaveAttribute('data-ai-proposed')
    await expect(panel.queryByText('AI-proposed Transform')).toBeNull()
    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()
    await expect(summary).toHaveTextContent(`${before - 1} AI proposals to review`)
  },
})

export const AcceptDraft = meta.story({
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept draft' }))

    const done = await canvas.findByText(
      'AI draft accepted. The Draft stays editable and can be published now.',
      {},
      { timeout: 5000 },
    )

    await waitFor(() => expect(done.closest('[role="status"]')).toHaveFocus())
    await expect(canvas.queryByText('AI review open')).toBeNull()
    await expect(aiMarks(canvasElement)).toHaveLength(0)
    await expect(canvas.queryAllByRole('group', { name: proposedEdge })).toHaveLength(0)
    await expect(canvas.queryByText('Accept the draft before publishing.')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled()

    await userEvent.click(transformNodeOf(canvasElement, 'Lookup Table 1').querySelector('button')!)
    await expect(
      (await detailsPanel(canvasElement)).getByRole('button', { name: 'Remove Lookup Table 1' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Draft with AI' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(done).toBeVisible()
  },
})

export const AcceptFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${acceptAiDraftEndpoint.path}`, () =>
        HttpResponse.json({ message: 'The AI draft could not be accepted.' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept draft' }))
    await expect(
      await canvas.findByText(
        'The AI draft could not be accepted. Try again.',
        {},
        { timeout: 5000 },
      ),
    ).toHaveAttribute('role', 'alert')
    await expect(canvas.getByText('AI review open')).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas, canvasElement }) {
      await expect(
        (await canvas.findAllByRole('group', { name: /^Link from/ })).length,
      ).toBeGreaterThan(0)
      await expect(canvas.queryByText('AI review open')).toBeNull()
      await expect(canvas.queryByText(/AI proposals? to review$/)).toBeNull()
      await expect(canvas.queryByText('Accept the draft before publishing.')).toBeNull()
      await expect(canvas.queryByRole('button', { name: 'Accept draft' })).toBeNull()
      await expect(canvas.queryAllByRole('button', { name: proposedRow })).toHaveLength(0)
      await expect(canvas.queryAllByRole('group', { name: proposedEdge })).toHaveLength(0)
      await expect(aiMarks(canvasElement)).toHaveLength(0)

      await userEvent.click(canvas.getByRole('button', { name: 'Lookup Table 1' }))
      await expect(
        (await detailsPanel(canvasElement)).getByRole('heading', { name: 'Lookup Table 1' }),
      ).toBeVisible()
      await expect((await detailsPanel(canvasElement)).queryByText(/AI-proposed/)).toBeNull()
    },
  }),
})

export const LargeVolume = meta.story({
  args: { id: large.id },
  beforeEach: reviewing(large),
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)
    await waitFor(() =>
      expect(canvas.getAllByRole('group', { name: proposedEdge }).length).toBeGreaterThan(20),
    )
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
    await expect(await canvas.findByText('Durchsicht des KI-Entwurfs offen')).toBeVisible()
    await expect(canvas.getByText('19 KI-Vorschläge zu prüfen')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'KI-Entwurf übernehmen' })).toBeVisible()
    await expect(
      canvas.getByText('Übernehmen Sie den KI-Entwurf, bevor Sie veröffentlichen.'),
    ).toBeVisible()
    await expect(
      (await canvas.findAllByRole('button', { name: /Von der KI vorgeschlagene Verknüpfung$/ }))
        .length,
    ).toBeGreaterThan(0)
  },
})

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

export const Dark = meta.story({
  beforeEach: [reviewing(outbound), darkMode],
  async play({ canvas, canvasElement }) {
    await findSummary(canvasElement)

    const [row] = await canvas.findAllByRole('button', { name: proposedRow })

    await userEvent.click(row!)
    await expect((await openDetails(canvasElement)).getByText('AI-proposed')).toBeVisible()
  },
})
