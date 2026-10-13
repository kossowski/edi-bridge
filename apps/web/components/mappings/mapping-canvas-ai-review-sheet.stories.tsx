import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  findSaveStatus,
  inReview,
  inReviewWith,
  openDetails,
  page,
  reviewing,
  seeded,
  target,
  findSheet,
  findSheetElement,
} from '@/components/mappings/mapping-canvas-story-helpers'
import { findRowButton } from '@/components/mappings/tree-node'
import { viewerStory } from '@/components/session/session-story-helpers'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingPreviewEndpoint } from '@edi-bridge/contracts'
import { aiProposalFor, seedDocumentStructures } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const outboundName = 'Alpenfrisch: ERP JSON to INVOIC'

const drafted = aiProposalFor(seeded(outboundName), seedDocumentStructures)

// The AI left a few required fields to the Admin.
const outbound = inReviewWith(outboundName, { ...drafted, links: drafted.links.slice(4) })

const quiet = inReview('Alpenfrisch: CONTRL to ERP JSON')

const large = inReview('Bodensee: ERP JSON to INVOIC', 'large')

const previewUrl = `${apiUrl}${mappingPreviewEndpoint.path}`

const wait = { timeout: 5000 }

let previewRequests = 0

const sheetName = 'What needs attention'

const countButton = /^\d+ needs? attention$/

async function findAttentionButton(canvasElement: HTMLElement, name: string | RegExp) {
  return within(canvasElement).findByRole('button', { name }, wait)
}

async function openSheet(
  canvasElement: HTMLElement,
  { name = sheetName, button = countButton }: { name?: string; button?: string | RegExp } = {},
) {
  await userEvent.click(await findAttentionButton(canvasElement, button))

  return findSheetElement(canvasElement, name)
}

function heading(title: string, count?: number) {
  return new RegExp(`^${title}${count === undefined ? '(\\s*\\d+)?' : `\\s*${count}`}$`)
}

function countOf(element: HTMLElement) {
  return Number(/(\d+)/.exec(element.textContent)![1])
}

function pathOf(entry: HTMLElement) {
  return entry.querySelector<HTMLElement>('[data-target-path]')!.dataset.targetPath!
}

function entriesUnder(sheet: HTMLElement, name: RegExp) {
  return within(within(sheet).getByRole('list', { name })).getAllByRole('button')
}

const unmapped = heading('Fields with nothing linked')

const changing = heading('Links that change the value')

const warnings = heading('Warnings on the example document')

const other = heading('Other links the AI proposed')

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/AiReviewSheet',
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

export const AllGroups = meta.story({
  async play({ canvasElement }) {
    const button = await findAttentionButton(canvasElement, countButton)
    const sheet = await openSheet(canvasElement)
    const groups = within(sheet)

    const counts = [
      countOf(groups.getByRole('heading', { name: unmapped })),
      countOf(groups.getByRole('heading', { name: heading('Links that change the value', 3) })),
      countOf(await groups.findByRole('heading', { name: warnings }, wait)),
    ]

    await expect(counts[0]).toBeGreaterThan(0)
    await expect(countOf(button)).toBe(counts.reduce((sum, count) => sum + count, 0))
    await expect(countOf(groups.getByRole('heading', { name: other }))).toBe(7)
    await expect(entriesUnder(sheet, other)).toHaveLength(7)
  },
})

export const NothingNeedsAttention = meta.story({
  args: { id: quiet.id },
  beforeEach: reviewing(quiet),
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement, { button: 'Nothing needs attention' }))

    await expect(sheet.getByText('Every required field has a link.')).toBeVisible()
    await expect(
      sheet.getByText('No link the AI proposed changes a value on its way.'),
    ).toBeVisible()
    await expect(
      await sheet.findByText(/^Trying the Draft on .+ gave no warnings\.$/),
    ).toBeVisible()
    await expect(
      sheet.getByRole('heading', { name: heading('Fields with nothing linked', 0) }),
    ).toBeVisible()
  },
})

export const PreviewLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(previewUrl, async () => {
        await delay('infinite')

        return HttpResponse.json({})
      }),
    )
  },
  async play({ canvasElement }) {
    const button = await findAttentionButton(canvasElement, sheetName)

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))

    const sheet = within(await openSheet(canvasElement, { button: sheetName }))

    await expect(
      await sheet.findByText('Trying the Draft on the example document'),
    ).toBeInTheDocument()
    await expect(sheet.getByRole('heading', { name: warnings })).toBeVisible()
    await expect(sheet.getByRole('heading', { name: unmapped })).toBeInTheDocument()
  },
})

export const PreviewError = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvasElement }) {
    const sheet = within(await openSheet(canvasElement))

    await waitFor(async () => {
      await expect(sheet.getByText('The warnings could not be loaded.')).toHaveAttribute(
        'role',
        'alert',
      )
      await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible()
    }, wait)
    await expect(
      sheet.getByRole('heading', { name: heading('Links that change the value', 3) }),
    ).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: large.id },
  beforeEach: reviewing(large),
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const others = within(sheet).getByRole('heading', { name: other })

    await expect(countOf(others)).toBeGreaterThan(50)
    await expect(entriesUnder(sheet, other)).toHaveLength(countOf(others))

    const body = within(sheet)
      .getByRole('heading', { name: unmapped })
      .closest<HTMLElement>('.overflow-y-auto')!

    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
  },
})

export const DetailAndBack = meta.story({
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const [entry] = entriesUnder(sheet, unmapped)
    const path = pathOf(entry!)
    const detail = within(sheet)

    entry!.focus()
    await userEvent.keyboard('{Enter}')

    await waitFor(async () => {
      const focused = canvasElement.ownerDocument.activeElement

      await expect(focused?.tagName).toBe('H3')
      await expect(focused).toHaveTextContent(path)
    })
    await expect(detail.getByRole('heading', { name: 'What to do' })).toBeVisible()
    await expect(detail.getByText(/^The trading partner needs this field/)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Show on canvas' })).toBeVisible()
    await expect(detail.queryByRole('heading', { name: changing })).toBeNull()

    await userEvent.click(detail.getByRole('button', { name: 'Back to the list' }))
    await waitFor(() => expect(entriesUnder(sheet, unmapped)[0]).toHaveFocus())
  },
})

export const ShowOnCanvas = meta.story({
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const [entry] = entriesUnder(sheet, unmapped)
    const path = pathOf(entry!)

    await userEvent.click(entry!)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show on canvas' }))
    await waitFor(() => expect(findRowButton(canvasElement, target(path))).toHaveFocus())
    await waitFor(() =>
      expect(page(canvasElement).queryByRole('dialog', { name: sheetName })).toBeNull(),
    )
    await expect(page(canvasElement).queryByRole('dialog', { name: 'Details' })).toBeNull()
    await expect(
      (await openDetails(canvasElement)).getByText('This part has no links yet.'),
    ).toBeVisible()
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }))
    await waitFor(() =>
      expect(page(canvasElement).queryByRole('dialog', { name: 'Details' })).toBeNull(),
    )

    const reopened = await openSheet(canvasElement)
    const [chain] = entriesUnder(reopened, changing)

    await userEvent.click(chain!)
    await userEvent.click(within(reopened).getByRole('button', { name: 'Show on canvas' }))
    await waitFor(() =>
      expect(
        canvasElement.ownerDocument.activeElement?.closest('.react-flow__node'),
      ).not.toBeNull(),
    )
    await waitFor(() =>
      expect(page(canvasElement).queryByRole('dialog', { name: sheetName })).toBeNull(),
    )
    await expect(page(canvasElement).queryByRole('dialog', { name: 'Details' })).toBeNull()
  },
})

export const RejectUpdatesList = meta.story({
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)
    const before = countOf(within(sheet).getByRole('heading', { name: other }))
    const [entry] = entriesUnder(sheet, other)
    const path = pathOf(entry!)

    await userEvent.click(entry!)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show on canvas' }))
    await waitFor(() => expect(findRowButton(canvasElement, target(path))).toHaveFocus())
    await userEvent.click(
      (await openDetails(canvasElement)).getByRole('button', {
        name: /^Reject the AI-proposed link from/,
      }),
    )

    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    const reopened = await openSheet(canvasElement)

    await waitFor(() =>
      expect(countOf(within(reopened).getByRole('heading', { name: other }))).toBe(before - 1),
    )
    await expect(entriesUnder(reopened, other).map(pathOf)).not.toContain(path)
  },
})

export const SheetLeavesCanvasFullWidth = meta.story({
  async play({ canvasElement }) {
    const button = await findAttentionButton(canvasElement, countButton)

    const frame = await waitFor(
      () => canvasElement.querySelector('.mapping-canvas')!.parentElement!,
    )

    await expect(page(canvasElement).queryByRole('dialog', { name: sheetName })).toBeNull()
    await expect(frame.getBoundingClientRect().right).toBeGreaterThan(
      canvasElement.ownerDocument.documentElement.clientWidth - 40,
    )

    const sheet = await openSheet(canvasElement)

    await expect(within(sheet).getByRole('heading', { name: unmapped })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(button).toHaveFocus())
  },
})

export const PreviewShowsReviewSample = meta.story({
  async play({ canvas, canvasElement }) {
    await findAttentionButton(canvasElement, countButton)

    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }))

    const sheet = await findSheet(canvasElement, 'Preview')

    await expect(await sheet.findByRole('combobox', { name: 'Example document' })).toBeVisible()
    await expect(
      await sheet.findByRole('region', { name: /^Target Document for / }, wait),
    ).toBeVisible()
  },
})

export const AcceptRemovesButton = meta.story({
  async play({ canvas, canvasElement }) {
    await findAttentionButton(canvasElement, countButton)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept draft' }))
    await canvas.findByText(
      'AI draft accepted. The Draft stays editable and can be published now.',
      {},
      wait,
    )
    await expect(canvas.queryByRole('button', { name: countButton })).toBeNull()
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
    const sheet = await openSheet(canvasElement, {
      name: 'Was zu prüfen ist',
      button: /^\d+ Einträge? mit Handlungsbedarf$/,
    })

    const groups = within(sheet)
    const fields = heading('Felder ohne Verknüpfung')

    await expect(countOf(groups.getByRole('heading', { name: fields }))).toBeGreaterThan(0)
    await expect(
      groups.getByRole('heading', { name: heading('Verknüpfungen, die den Wert ändern', 3) }),
    ).toBeVisible()
    await expect(
      groups.getByRole('heading', { name: heading('Weitere Verknüpfungen der KI', 7) }),
    ).toBeVisible()

    await userEvent.click(entriesUnder(sheet, fields)[0]!)
    await expect(groups.getByRole('button', { name: 'Zurück zur Liste' })).toBeVisible()
    await expect(groups.getByRole('button', { name: 'Auf der Zeichenfläche zeigen' })).toBeVisible()
  },
})

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

export const Dark = meta.story({
  beforeEach: [reviewing(outbound), darkMode],
  async play({ canvasElement }) {
    const sheet = await openSheet(canvasElement)

    await expect(await within(sheet).findByRole('heading', { name: warnings }, wait)).toBeVisible()
    await userEvent.click(entriesUnder(sheet, changing)[0]!)
    await expect(within(sheet).getByRole('heading', { name: 'What to do' })).toBeVisible()
  },
})

export const SmallScreen = meta.story({
  globals: { viewport: { value: 'tablet', isRotated: false } },
  beforeEach: [
    reviewing(outbound),
    ({ msw }) => {
      msw.use(
        http.post(previewUrl, () => {
          previewRequests += 1

          return HttpResponse.json({ message: 'Unexpected' }, { status: 500 })
        }),
      )
      previewRequests = 0
    },
  ],
  async play({ canvas }) {
    await expect(await canvas.findByText('The Mapping canvas needs a larger screen')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await expect(previewRequests).toBe(0)
    await expect(canvas.queryByRole('button', { name: /attention$/ })).toBeNull()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        (await canvas.findAllByRole('group', { name: /^Link from/ })).length,
      ).toBeGreaterThan(0)
      await expect(canvas.queryByRole('button', { name: /attention$/ })).toBeNull()
      await expect(canvas.getByRole('button', { name: 'Preview' })).toBeVisible()
    },
  }),
})
