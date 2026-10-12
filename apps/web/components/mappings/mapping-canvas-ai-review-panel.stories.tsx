import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import {
  detailsPanel,
  findSaveStatus,
  inReview,
  inReviewWith,
  page,
  reviewing,
  seeded,
  target,
  findSheet,
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

// The AI left a few required elements to the Admin.
const outbound = inReviewWith(outboundName, { ...drafted, links: drafted.links.slice(4) })

const quiet = inReview('Alpenfrisch: CONTRL to ERP JSON')

const large = inReview('Bodensee: ERP JSON to INVOIC', 'large')

const previewUrl = `${apiUrl}${mappingPreviewEndpoint.path}`

const wait = { timeout: 5000 }

async function findShowButton(canvasElement: HTMLElement, name = 'What needs attention') {
  return within(canvasElement).findByRole('button', { name }, wait)
}

async function findPanel(
  canvasElement: HTMLElement,
  { name = 'AI review', button = 'What needs attention' } = {},
) {
  await userEvent.click(await findShowButton(canvasElement, button))

  const sheet = await page(canvasElement).findByRole('dialog', { name }, wait)

  await waitFor(() => expect(sheet).toBeVisible())

  return sheet
}

function heading(title: string, count?: number) {
  return new RegExp(`^${title}${count === undefined ? '(\\s*\\d+)?' : `\\s*${count}`}$`)
}

function otherLinks(panel: HTMLElement) {
  return within(panel).getByRole('button', { name: /^Other AI-proposed links\s*\d+$/ })
}

function countOf(element: HTMLElement) {
  return Number(/(\d+)$/.exec(element.textContent)![1])
}

function pathOf(item: HTMLElement) {
  return item.querySelector<HTMLElement>('[data-target-path]')!.dataset.targetPath!
}

function itemsUnder(panel: HTMLElement, name: RegExp) {
  return within(within(panel).getByRole('list', { name })).getAllByRole('button')
}

const unmappedHeading = heading('Required target elements left unmapped')

const meta = preview.meta({
  title: 'Mappings/MappingCanvasScreen/AiReviewPanel',
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
    const region = await findPanel(canvasElement)
    const panel = within(region)

    await expect(countOf(panel.getByRole('heading', { name: unmappedHeading }))).toBeGreaterThan(0)
    await expect(
      panel.getByRole('heading', { name: heading('AI-proposed links through Transforms', 2) }),
    ).toBeVisible()
    await expect(
      await panel.findByRole('heading', { name: /^Warnings on the Sample Document\s*\d+$/ }, wait),
    ).toBeVisible()

    const other = otherLinks(region)

    await expect(other).toHaveAttribute('aria-expanded', 'false')
    await expect(countOf(other)).toBe(7)
    await userEvent.click(other)
    await expect(other).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getAllByText(/^From /).length).toBeGreaterThanOrEqual(7)
  },
})

export const NothingNeedsAttention = meta.story({
  args: { id: quiet.id },
  beforeEach: reviewing(quiet),
  async play({ canvasElement }) {
    const panel = within(await findPanel(canvasElement))

    await expect(panel.getByText('Every required target element is mapped.')).toBeVisible()
    await expect(
      panel.getByText('No AI-proposed link runs through a Transform or Lookup Table.'),
    ).toBeVisible()
    await expect(
      await panel.findByText(/^The preview shows no warnings on /, {}, wait),
    ).toBeVisible()
    await expect(
      panel.getByRole('heading', { name: heading('Required target elements left unmapped', 0) }),
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
    const panel = within(await findPanel(canvasElement))

    await expect(
      await panel.findByText('Checking the Draft against the Sample Document'),
    ).toBeInTheDocument()
    await expect(
      panel.getByRole('heading', { name: heading('Warnings on the Sample Document') }),
    ).toBeVisible()
    await expect(panel.getByRole('heading', { name: unmappedHeading })).toBeInTheDocument()
  },
})

export const PreviewError = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post(previewUrl, () => HttpResponse.json({ message: 'Down' }, { status: 500 })))
  },
  async play({ canvasElement }) {
    const panel = within(await findPanel(canvasElement))

    await waitFor(async () => {
      await expect(panel.getByText('The warnings could not be loaded.')).toHaveAttribute(
        'role',
        'alert',
      )
      await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible()
    }, wait)
    await expect(
      panel.getByRole('heading', { name: heading('AI-proposed links through Transforms', 2) }),
    ).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { id: large.id },
  beforeEach: reviewing(large),
  async play({ canvasElement }) {
    const region = await findPanel(canvasElement)
    const other = otherLinks(region)

    await expect(countOf(other)).toBeGreaterThan(50)
    await userEvent.click(other)
    await waitFor(() =>
      expect(itemsUnder(region, /^Other AI-proposed links$/).length).toBe(countOf(other)),
    )

    const body = within(region)
      .getByRole('heading', { name: unmappedHeading })
      .closest<HTMLElement>('.overflow-y-auto')!

    await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
  },
})

export const ItemShowsOnCanvas = meta.story({
  async play({ canvasElement }) {
    const region = await findPanel(canvasElement)
    const [unmapped] = itemsUnder(region, unmappedHeading)
    const path = pathOf(unmapped!)

    await userEvent.click(unmapped!)
    await waitFor(() => expect(findRowButton(canvasElement, target(path))).toHaveFocus())
    await expect(
      (await detailsPanel(canvasElement)).getByText('This part has no links yet.'),
    ).toBeVisible()

    await waitFor(() =>
      expect(page(canvasElement).queryByRole('dialog', { name: 'AI review' })).toBeNull(),
    )

    const [chain] = itemsUnder(
      await findPanel(canvasElement),
      heading('AI-proposed links through Transforms'),
    )

    await userEvent.click(chain!)
    await waitFor(() =>
      expect(
        canvasElement.ownerDocument.activeElement?.closest('.react-flow__node'),
      ).not.toBeNull(),
    )
    await expect(
      (await detailsPanel(canvasElement)).getByRole('heading', { name: /AI-proposed Transform$/ }),
    ).toBeVisible()
  },
})

export const RejectUpdatesList = meta.story({
  async play({ canvasElement }) {
    const region = await findPanel(canvasElement)
    const other = otherLinks(region)
    const before = countOf(other)

    await userEvent.click(other)

    const [item] = itemsUnder(region, /^Other AI-proposed links$/)
    const path = pathOf(item!)

    await userEvent.click(item!)
    await waitFor(() => expect(findRowButton(canvasElement, target(path))).toHaveFocus())
    await userEvent.click(
      (await detailsPanel(canvasElement)).getByRole('button', {
        name: /^Reject the AI-proposed link from/,
      }),
    )

    await expect(await findSaveStatus(canvasElement, 'Saved')).toBeVisible()

    const reopened = await findPanel(canvasElement)

    await waitFor(() => expect(countOf(otherLinks(reopened))).toBe(before - 1))
    await userEvent.click(otherLinks(reopened))
    await expect(itemsUnder(reopened, /^Other AI-proposed links$/).map(pathOf)).not.toContain(path)
  },
})

export const SheetLeavesCanvasFullWidth = meta.story({
  async play({ canvasElement }) {
    const show = await findShowButton(canvasElement)

    const frame = await waitFor(
      () => canvasElement.querySelector('.mapping-canvas')!.parentElement!,
    )

    await expect(page(canvasElement).queryByRole('dialog', { name: 'AI review' })).toBeNull()
    await expect(frame.getBoundingClientRect().right).toBeGreaterThan(
      canvasElement.ownerDocument.documentElement.clientWidth - 40,
    )

    const region = await findPanel(canvasElement)

    await expect(within(region).getByRole('heading', { name: unmappedHeading })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page(canvasElement).queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(show).toHaveFocus())
  },
})

export const PreviewShowsReviewSample = meta.story({
  async play({ canvas, canvasElement }) {
    await findShowButton(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }))

    const preview = await findSheet(canvasElement, 'Preview')

    await expect(await preview.findByRole('combobox', { name: 'Example document' })).toBeVisible()
    await expect(
      await preview.findByRole('region', { name: /^Target Document for / }, wait),
    ).toBeVisible()
  },
})

export const AcceptRemovesPanel = meta.story({
  async play({ canvas, canvasElement }) {
    await findShowButton(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept draft' }))
    await canvas.findByText(
      'AI draft accepted. The Draft stays editable and can be published now.',
      {},
      wait,
    )
    await expect(canvas.queryByRole('button', { name: 'What needs attention' })).toBeNull()
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
    const panel = within(
      await findPanel(canvasElement, {
        name: 'Durchsicht des KI-Entwurfs',
        button: 'Was zu prüfen ist',
      }),
    )

    await expect(
      countOf(
        panel.getByRole('heading', { name: heading('Pflicht-Zielelemente ohne Verknüpfung') }),
      ),
    ).toBeGreaterThan(0)
    await expect(
      panel.getByRole('heading', { name: heading('KI-Verknüpfungen über Transforms', 2) }),
    ).toBeVisible()
    await expect(
      panel.getByRole('button', { name: /^Weitere KI-Verknüpfungen\s*7$/ }),
    ).toBeVisible()
  },
})

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

export const Dark = meta.story({
  beforeEach: [reviewing(outbound), darkMode],
  async play({ canvasElement }) {
    const region = await findPanel(canvasElement)

    await userEvent.click(otherLinks(region))
    await expect(
      await within(region).findByRole('heading', { name: /^Warnings on the Sample Document/ }),
    ).toBeVisible()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        (await canvas.findAllByRole('img', { name: /^Link from/ })).length,
      ).toBeGreaterThan(0)
      await expect(canvas.queryByRole('button', { name: 'What needs attention' })).toBeNull()
      await expect(canvas.getByRole('button', { name: 'Preview' })).toBeVisible()
    },
  }),
})
