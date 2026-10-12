import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { DocumentScreen } from '@/components/documents/document-screen'
import { flowFor, partner, storyRunFactory } from '@/components/documents/document-story-helpers'
import {
  darkMode,
  desktop,
  expectNoPageScroll,
  german,
  laptop,
  mobile,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { runDetailSchema, runEndpoint, toPath } from '@edi-bridge/contracts'
import {
  controlReferenceOf,
  runDetailHandlers,
  seedMappingVersions,
  serializeSegment,
  toMappingVersionSummary,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const storyRun = storyRunFactory({ idPrefix: '41000000', hour: '08' })

const delivered = storyRun(1, 'ORDERS', 'delivered')

const unreadable = storyRun(2, 'ORDERS', 'parse')

const invalidContent = storyRun(3, 'ORDERS', 'validation')

const missingCode = storyRun(4, 'ORDERS', 'mapping')

const unreachable = storyRun(5, 'INVOIC', 'delivery')

const processing = storyRun(6, 'ORDERS', 'processing')

const duplicate = storyRun(7, 'DESADV', 'duplicate')

const outboundMissingField = storyRun(8, 'INVOIC', 'mapping')

const replaced = storyRun(9, 'ORDERS', 'mapping')

const replacing = storyRun(10, 'ORDERS', 'delivered')

const invoice = storyRun(11, 'INVOIC', 'delivered')

const runs = [
  delivered,
  unreadable,
  invalidContent,
  missingCode,
  unreachable,
  processing,
  duplicate,
  outboundMissingField,
  replaced,
  replacing,
  invoice,
]

const largeLineCount = 600

function largeDetail() {
  const flow = flowFor('ORDERS')
  const run = storyRun(50, 'ORDERS', 'delivered')
  const interchangeId = '41000000-0000-4000-8000-100000000000'

  const segments = [
    { tag: 'UNH', name: 'Message header', elements: [['1'], ['ORDERS', 'D', '96A', 'UN']] },
    { tag: 'BGM', name: 'Beginning of message', elements: [['220'], ['PO900001'], ['9']] },
    ...Array.from({ length: largeLineCount }, (_, index) => [
      {
        tag: 'LIN',
        name: 'Line item',
        elements: [[String(index + 1)], [''], [`40${String(index).padStart(11, '0')}`, 'EN']],
      },
      { tag: 'QTY', name: 'Quantity', elements: [['21', String((index % 40) + 1), 'PCE']] },
    ]).flat(),
    { tag: 'UNT', name: 'Message trailer', elements: [[String(largeLineCount * 2 + 3)], ['1']] },
  ]

  const raw = [
    "UNA:+.? '",
    `UNB+UNOC:3+4012345000009:14+4099999000001:14+261008:0850+${controlReferenceOf(interchangeId)}'`,
    ...segments.map(serializeSegment),
    `UNZ+1+${controlReferenceOf(interchangeId)}'`,
  ].join('')

  return runDetailSchema.parse({
    ...run,
    steps: (['receipt', 'parse', 'validation', 'mapping', 'delivery'] as const).map(
      (stage, index) => ({
        stage,
        status: 'succeeded',
        startedAt: `2026-10-08T08:50:1${index}.000Z`,
        finishedAt: `2026-10-08T08:50:1${index}.400Z`,
      }),
    ),
    interchange: { id: interchangeId, controlReference: controlReferenceOf(interchangeId), raw },
    message: { reference: '1', messageType: 'ORDERS', segments },
    mappingVersion: toMappingVersionSummary(
      seedMappingVersions.find(({ id }) => id === flow.mappingVersionId)!,
    ),
    replaces: null,
    replacedBy: null,
    error: null,
    problem: null,
    waitingForTradingPartnerSince: null,
    duplicateOf: null,
  })
}

const large = largeDetail()

const meta = preview.meta({
  title: 'Documents/DocumentScreen/PathAndTabs',
  component: DocumentScreen,
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/documents/1', query: {} } },
  },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${toPath(runEndpoint.path, { id: large.id })}`, () =>
        HttpResponse.json(large),
      ),
      ...runDetailHandlers(apiUrl, {
        runs,
        reprocessed: [{ replaced: replaced.id, replacing: replacing.id }],
      }),
    )
  },
})

const contentQuery = { nextjs: { navigation: { query: { tab: 'content' } } } }

const technicalQuery = { nextjs: { navigation: { query: { tab: 'technical' } } } }

const contentTab = { parameters: contentQuery }

const technicalTab = { parameters: technicalQuery }

// Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
// outrun the test timeout on CI, so only the structural rules run here.
const largeA11y = { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } }

async function pathSteps(canvasElement: HTMLElement) {
  const path = await within(canvasElement).findByRole('list', {
    name: 'The path of this document',
  })

  return within(path)
    .getAllByRole('button')
    .map((step) => step.textContent)
}

function wordsBrokenAcrossLines(path: HTMLElement) {
  return [...path.querySelectorAll<HTMLElement>('[aria-hidden] > span')].flatMap((span) => {
    const text = span.firstChild!
    let offset = 0

    return text.textContent!.split(' ').filter((word) => {
      const range = document.createRange()
      range.setStart(text, offset)
      range.setEnd(text, offset + word.length)
      offset += word.length + 1

      return range.getClientRects().length > 1
    })
  })
}

async function expectWholeGermanWords(canvasElement: HTMLElement) {
  const path = await within(canvasElement).findByRole('list', { name: 'Der Weg dieses Belegs' })
  await expect(wordsBrokenAcrossLines(path)).toEqual([])
  await expect(path.scrollWidth).toBeLessThanOrEqual(path.clientWidth)
  await expectNoPageScroll(canvasElement)
}

export const PathDelivered = meta.story({
  args: { id: delivered.id },
  async play({ canvasElement }) {
    await expect(await pathSteps(canvasElement)).toEqual([
      'Received: done',
      'Read: done',
      'Checked: done',
      'Translated: done',
      'Delivered: done',
    ])
  },
})

export const PathFailedAtRead = meta.story({
  args: { id: unreadable.id },
  async play({ canvasElement }) {
    await expect(await pathSteps(canvasElement)).toEqual([
      'Received: done',
      'Read: failed here',
      'Checked: not reached',
      'Translated: not reached',
      'Delivered: not reached',
    ])
  },
})

export const PathFailedAtCheck = meta.story({
  args: { id: invalidContent.id },
  async play({ canvasElement }) {
    await expect((await pathSteps(canvasElement))[2]).toBe('Checked: failed here')
  },
})

export const PathFailedAtTranslate = meta.story({
  args: { id: missingCode.id },
  async play({ canvasElement }) {
    await expect((await pathSteps(canvasElement))[3]).toBe('Translated: failed here')
  },
})

export const PathFailedAtDelivery = meta.story({
  args: { id: unreachable.id },
  async play({ canvasElement }) {
    await expect(await pathSteps(canvasElement)).toEqual([
      'Received: done',
      'Translated: done',
      'Checked: done',
      'Delivered: failed here',
    ])
  },
})

export const PathInProgress = meta.story({
  args: { id: processing.id },
  async play({ canvasElement }) {
    const steps = await pathSteps(canvasElement)
    await expect(steps.filter((step) => step.endsWith(': in progress'))).toHaveLength(1)
    await expect(steps[0]).toBe('Received: done')
  },
})

export const PathDuplicate = meta.story({
  args: { id: duplicate.id },
  async play({ canvasElement }) {
    await expect(await pathSteps(canvasElement)).toEqual([
      'Received: done',
      'Translated: skipped',
      'Checked: skipped',
      'Delivered: skipped',
    ])
  },
})

export const PathHintOnFocus = meta.story({
  args: { id: missingCode.id },
  async play({ canvas }) {
    const step = await canvas.findByRole('button', { name: 'Translated: failed here' })
    const hint = 'EDI Bridge converted the document into the format of your ERP.'
    await expect(step).toHaveAccessibleDescription(hint)

    canvas.getByRole('button', { name: 'Checked: done' }).focus()
    await userEvent.tab()
    await expect(step).toHaveFocus()
    const tooltip = await screen.findByText(hint, { selector: '[data-slot="tooltip-content"]' })
    await waitFor(() => expect(tooltip).toBeVisible())
  },
})

export const PathHintOnHover = meta.story({
  args: { id: unreachable.id },
  async play({ canvas }) {
    await userEvent.hover(await canvas.findByRole('button', { name: 'Delivered: failed here' }))

    const tooltip = await screen.findByText(`EDI Bridge sent the document to ${partner.name}.`, {
      selector: '[data-slot="tooltip-content"]',
    })

    await waitFor(() => expect(tooltip).toBeVisible())
  },
})

export const Summary = meta.story({
  args: { id: delivered.id },
  async play({ canvas }) {
    const facts = within(await canvas.findByLabelText('Summary', { selector: 'dl' }))
    await expect(facts.getByText('Purchase order')).toBeVisible()
    await expect(facts.getByRole('link', { name: partner.name })).toHaveAttribute(
      'href',
      `/trading-partners/${partner.id}`,
    )
    await expect(facts.getByRole('link', { name: delivered.businessReference! })).toHaveAttribute(
      'href',
      `/orders/${delivered.businessReference}`,
    )
    await expect(facts.getByText(`Incoming: from ${partner.name} to your ERP`)).toBeVisible()
    await expect(facts.getByRole('link', { name: flowFor('ORDERS').name })).toHaveAttribute(
      'href',
      `/flows/${flowFor('ORDERS').id}`,
    )
    await expect(facts.getByText('Through a connection')).toBeVisible()
  },
})

export const ChooseTechnicalTab = meta.story({
  args: { id: delivered.id },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Technical details' }))
    await expect(getRouter().replace).toHaveBeenCalledWith('/documents/1?tab=technical', {
      scroll: false,
    })
  },
})

export const Content = meta.story({
  ...contentTab,
  args: { id: missingCode.id },
  async play({ canvas }) {
    const table = await canvas.findByRole('region', { name: 'Lines of the document' })

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)

    await expect(headers).toEqual(['Line', 'Article number (GTIN)', 'Quantity', 'Unit'])
    await expect(within(table).getByText('KRT (no translation)')).toBeVisible()
  },
})

export const ContentWithAmounts = meta.story({
  ...contentTab,
  args: { id: invoice.id },
  async play({ canvas }) {
    const table = await canvas.findByRole('region', { name: 'Lines of the document' })
    await expect(within(table).getByRole('columnheader', { name: 'Amount' })).toBeVisible()
  },
})

export const ContentUnreadable = meta.story({
  ...contentTab,
  args: { id: unreadable.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No lines to show')).toBeVisible()
    await expect(
      canvas.getByText(/could not read or translate this document/, { exact: false }),
    ).toBeVisible()
  },
})

export const ContentNotTranslated = meta.story({
  ...contentTab,
  args: { id: outboundMissingField.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('No lines to show')).toBeVisible()
  },
})

export const TechnicalDetails = meta.story({
  ...technicalTab,
  args: { id: invalidContent.id },
  async play({ canvas, canvasElement }) {
    const facts = within(await canvas.findByLabelText('Technical details', { selector: 'dl' }))
    await expect(facts.getByText('Checked')).toBeVisible()
    await expect(facts.getByText('ORDERS')).toBeVisible()
    await expect(facts.getByText('invalidDate')).toBeVisible()
    await expect(facts.getByText(/^Segment \d+ \(DTM\), element 1, component 2$/)).toBeVisible()
    await expect(facts.getByRole('link', { name: /^Control reference \d+$/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\?view=transmissions&q=\d+$/),
    )
    await expect(facts.getByText(invalidContent.id)).toBeVisible()
    await expect(
      canvas.getByRole('region', { name: 'Transmission as sent, one segment per line' }),
    ).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-error-line]')).toHaveLength(1)
    await expect(canvas.getByRole('region', { name: 'Segments of the message' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Step timings' })).toBeVisible()
  },
})

export const TechnicalReplaced = meta.story({
  ...technicalTab,
  args: { id: replaced.id },
  async play({ canvas }) {
    const facts = within(await canvas.findByLabelText('Technical details', { selector: 'dl' }))
    await expect(facts.getByText('Replaced by')).toBeVisible()
    await expect(facts.getByRole('link', { name: /^Document / })).toHaveAttribute(
      'href',
      `/documents/${replacing.id}`,
    )
  },
})

export const TechnicalReplacing = meta.story({
  ...technicalTab,
  args: { id: replacing.id },
  async play({ canvas }) {
    const facts = within(await canvas.findByLabelText('Technical details', { selector: 'dl' }))
    await expect(facts.getByRole('link', { name: /^Document / })).toHaveAttribute(
      'href',
      `/documents/${replaced.id}`,
    )
  },
})

export const TechnicalUnreadable = meta.story({
  ...technicalTab,
  args: { id: unreadable.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        'The message could not be read. The transmission shows the error position.',
      ),
    ).toBeVisible()
    const facts = within(canvas.getByLabelText('Technical details', { selector: 'dl' }))
    await expect(facts.getByText('Message type').nextElementSibling).toHaveTextContent('ORDERS')
  },
})

export const LargeContent = meta.story({
  ...contentTab,
  parameters: { ...contentQuery, ...largeA11y },
  args: { id: large.id },
  async play({ canvas, canvasElement }) {
    const table = await canvas.findByRole('region', { name: 'Lines of the document' })
    await expect(
      canvas.getByText(`A readable view of the lines in this document. ${largeLineCount} lines`),
    ).toBeVisible()
    await expect(within(table).getAllByRole('row')).toHaveLength(largeLineCount + 1)
    await expect(table.scrollHeight).toBeGreaterThan(table.clientHeight)
    await expectNoPageScroll(canvasElement)
  },
})

export const LargeTechnicalDetails = meta.story({
  ...technicalTab,
  parameters: { ...technicalQuery, ...largeA11y },
  args: { id: large.id },
  async play({ canvas, canvasElement }) {
    const tree = await canvas.findByRole('region', { name: 'Segments of the message' })
    await expect(tree.scrollHeight).toBeGreaterThan(tree.clientHeight)
    const raw = canvas.getByRole('region', { name: 'Transmission as sent, one segment per line' })
    await expect(raw.scrollHeight).toBeGreaterThan(raw.clientHeight)
    await expectNoPageScroll(canvasElement)
  },
})

export const German = meta.story({
  ...contentTab,
  args: { id: missingCode.id },
  decorators: [german],
  async play({ canvas }) {
    const path = await canvas.findByRole('list', { name: 'Der Weg dieses Belegs' })
    await expect(
      within(path).getByRole('button', { name: 'Übersetzt: hier fehlgeschlagen' }),
    ).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Inhalt' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByText('KRT (keine Übersetzung)')).toBeVisible()
  },
})

export const GermanTechnicalDetails = meta.story({
  ...technicalTab,
  args: { id: invalidContent.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByLabelText('Technische Details', { selector: 'dl' }),
    ).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Dauer der Schritte' })).toBeVisible()
  },
})

export const DarkPath = meta.story({
  args: { id: unreadable.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Read: failed here' })).toBeVisible()
  },
})

export const DarkContent = meta.story({
  ...contentTab,
  args: { id: missingCode.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('KRT (no translation)')).toBeVisible()
  },
})

export const DarkTechnicalDetails = meta.story({
  ...technicalTab,
  args: { id: invalidContent.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvasElement, canvas }) {
    await expect(
      await canvas.findByLabelText('Technical details', { selector: 'dl' }),
    ).toBeVisible()
    await expect(canvasElement.querySelectorAll('mark')).toHaveLength(1)
  },
})

export const MobilePath = meta.story({
  ...mobile,
  args: { id: missingCode.id },
  async play({ canvas, canvasElement }) {
    const path = await canvas.findByRole('list', { name: 'The path of this document' })
    await expectNoPageScroll(canvasElement)
    await expect(path.scrollWidth).toBeLessThanOrEqual(path.clientWidth)
  },
})

export const GermanMobilePath = meta.story({
  ...mobile,
  args: { id: missingCode.id },
  decorators: [german],
  async play({ canvasElement }) {
    await expectWholeGermanWords(canvasElement)
  },
})

export const GermanLaptopPath = meta.story({
  ...laptop,
  args: { id: unreadable.id },
  decorators: [german],
  async play({ canvasElement }) {
    await expectWholeGermanWords(canvasElement)
  },
})

export const MobileContent = meta.story({
  ...mobile,
  parameters: { ...mobile.parameters, ...contentQuery },
  args: { id: missingCode.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('region', { name: 'Lines of the document' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const DesktopContent = meta.story({
  ...desktop,
  parameters: { ...desktop.parameters, ...contentQuery },
  args: { id: missingCode.id },
  async play({ canvas }) {
    const table = await canvas.findByRole('region', { name: 'Lines of the document' })
    const line = within(table).getByRole('columnheader', { name: 'Line' })
    await expect(line.getBoundingClientRect().width).toBeLessThan(table.clientWidth / 10)
  },
})

export const MobileTechnicalDetails = meta.story({
  ...mobile,
  parameters: { ...mobile.parameters, ...technicalQuery },
  args: { id: invalidContent.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByLabelText('Technical details', { selector: 'dl' }),
    ).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
