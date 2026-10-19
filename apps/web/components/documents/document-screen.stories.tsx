import { delay, http, HttpResponse } from 'msw'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { DocumentScreen } from '@/components/documents/document-screen'
import { flowFor, partner, storyRunFactory } from '@/components/documents/document-story-helpers'
import { viewerStory } from '@/components/session/session-story-helpers'
import {
  besideSidebar,
  darkMode,
  expectNoPageScroll,
  german,
  mobile,
  tablet,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  mappingVersionsEndpoint,
  reprocessRunEndpoint,
  retryRunEndpoint,
  runDetailSchema,
  runEndpoint,
  type RunDetail,
  type RunError,
  type RunProblem,
  toPath,
  waitForTradingPartnerRunEndpoint,
} from '@edi-bridge/contracts'
import {
  controlReferenceOf,
  createLookupTableStore,
  interchangeIdOf,
  mappingHandlers,
  runDetailHandlers,
  seedChannels,
  seedMappingDrafts,
  seedMappingVersions,
  seedWorkspace,
  toMappingVersionSummary,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const storyRun = storyRunFactory({ idPrefix: '40000000', hour: '07' })

const missingField = storyRun(1, 'INVOIC', 'mapping')

const missingFieldMapping = toMappingVersionSummary(
  seedMappingVersions.find(({ id }) => id === flowFor('INVOIC').mappingVersionId)!,
)

const missingFieldDetail = runDetailSchema.parse({
  ...missingField,
  steps: [
    { stage: 'receipt', status: 'succeeded' },
    { stage: 'mapping', status: 'failed' },
    { stage: 'validation', status: 'skipped' },
    { stage: 'delivery', status: 'skipped' },
  ].map((step) => ({ ...step, startedAt: null, finishedAt: null })),
  interchange: null,
  message: null,
  mappingVersion: missingFieldMapping,
  replaces: null,
  replacedBy: null,
  error: {
    code: 'missingSourceField',
    message: 'The source field lines[].gtin is empty',
    position: null,
    details: null,
  },
  problem: {
    reason: 'missingField',
    whoFixes: 'you',
    fixTarget: {
      kind: 'mapping',
      mappingId: missingFieldMapping.mappingId,
      name: missingFieldMapping.mappingName,
      fieldPath: 'lines[].gtin',
    },
  },
  waitingForTradingPartnerSince: null,
  duplicateOf: null,
})

const unreadable = storyRun(2, 'ORDERS', 'parse')

const invalidContentInbound = storyRun(3, 'ORDERS', 'validation')

const invalidContentOutbound = storyRun(4, 'DESADV', 'validation')

const missingCode = storyRun(5, 'INVOIC', 'mapping')

const unreachableOutbound = storyRun(6, 'INVOIC', 'delivery')

const unreachableInbound = storyRun(7, 'ORDERS', 'delivery')

const delivered = storyRun(8, 'ORDERS', 'delivered')

const uploaded = storyRun(9, 'ORDERS', 'delivered', { manualSubmission: true })

const processing = storyRun(10, 'ORDERS', 'processing')

const received = storyRun(11, 'ORDERS', 'received')

const original = storyRun(12, 'ORDERS', 'delivered', { receivedAt: '2026-10-07T07:00:00.000Z' })

const duplicateRun = storyRun(13, 'ORDERS', 'duplicate')

const duplicate = {
  ...duplicateRun,
  interchange: {
    id: interchangeIdOf(duplicateRun),
    controlReference: controlReferenceOf(interchangeIdOf(original)),
  },
}

const duplicateFromErp = storyRun(14, 'INVOIC', 'duplicate')

const replaced = storyRun(15, 'ORDERS', 'mapping')

const replacing = storyRun(16, 'ORDERS', 'delivered')

const incompleteSetup = storyRun(17, 'INVOIC', 'delivery')

const runs = [
  missingField,
  unreadable,
  invalidContentInbound,
  invalidContentOutbound,
  missingCode,
  unreachableOutbound,
  unreachableInbound,
  delivered,
  uploaded,
  processing,
  received,
  original,
  duplicate,
  duplicateFromErp,
  replaced,
  replacing,
  incompleteSetup,
]

const channel = seedChannels.find(({ id }) => id === flowFor('INVOIC').destinationChannelId)!

type IncompleteSetup = { error: RunError; fixTarget: RunProblem['fixTarget'] }

function incompleteSetupDetail({ error, fixTarget }: IncompleteSetup) {
  return runDetailSchema.parse({
    ...incompleteSetup,
    steps: [
      { stage: 'receipt', status: 'succeeded' },
      { stage: 'mapping', status: 'succeeded' },
      { stage: 'validation', status: 'succeeded' },
      { stage: 'delivery', status: 'failed' },
    ].map((step) => ({ ...step, startedAt: null, finishedAt: null })),
    interchange: null,
    message: null,
    mappingVersion: missingFieldMapping,
    replaces: null,
    replacedBy: null,
    error,
    problem: { reason: 'incompleteSetup', whoFixes: 'retry', fixTarget },
    waitingForTradingPartnerSince: null,
    duplicateOf: null,
  })
}

function servingIncompleteSetup(setup: IncompleteSetup) {
  return http.get(`${apiUrl}${toPath(runEndpoint.path, { id: incompleteSetup.id })}`, () =>
    HttpResponse.json(incompleteSetupDetail(setup)),
  )
}

const meta = preview.meta({
  title: 'Documents/DocumentScreen',
  component: DocumentScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${toPath(runEndpoint.path, { id: missingField.id })}`, () =>
        HttpResponse.json(missingFieldDetail),
      ),
      ...runDetailHandlers(apiUrl, {
        runs,
        reprocessed: [{ replaced: replaced.id, replacing: replacing.id }],
      }),
    )
  },
})

const invoicMappingId = seedMappingVersions.find(
  ({ id }) => id === flowFor('INVOIC').mappingVersionId,
)!.mappingId

const invoicMapping = seedMappingDrafts.find(({ id }) => id === invoicMappingId)!

function invoicMappingDraft(unpublishedChanges: boolean) {
  return mappingHandlers(apiUrl, {
    mappings: seedMappingDrafts.map((draft) =>
      draft.id === invoicMappingId ? { ...draft, unpublishedChanges } : draft,
    ),
  })
}

function failing(path: string) {
  return http.post(`${apiUrl}${path}`, () =>
    HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
  )
}

const writeText = fn<(text: string) => Promise<void>>(() => Promise.resolve())

function stubClipboard() {
  writeText.mockClear()
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  }
}

async function expectFixLink(link: HTMLElement, href: string) {
  await expect(link).toBeVisible()
  await expect(link.getAttribute('href')).toBe(href)
}

export const UnreadableFile = meta.story({
  args: { id: unreadable.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: `${partner.name} sent a damaged file` }),
    ).toBeVisible()
    await expect(canvas.getByText('Your partner fixes this')).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Open ${partner.name}` }),
      `/trading-partners/${partner.id}`,
    )
  },
})

export const InvalidContentFromPartner = meta.story({
  args: { id: invalidContentInbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The content breaks the EDI rules' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        `Nothing to fix on your side. ${partner.name} has to send a corrected file.`,
      ),
    ).toBeVisible()
  },
})

export const OpenedAtWhatToDo = meta.story({
  args: { id: unreadable.id },
  beforeEach() {
    const { href } = window.location

    window.history.replaceState(window.history.state, '', '#what-to-do')

    return () => window.history.replaceState(window.history.state, '', href)
  },
  async play({ canvas }) {
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 3, name: 'What to do' })).toHaveFocus(),
    )
  },
})

export const WaitingForPartner = meta.story({
  args: { id: unreadable.id },
  async beforeEach() {
    await fetch(
      `${apiUrl}${toPath(waitForTradingPartnerRunEndpoint.path, { id: unreadable.id })}`,
      {
        method: 'POST',
      },
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(`Marked as waiting for ${partner.name} since`, { exact: false }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Marked as waiting' })).toBeDisabled()
  },
})

export const InvalidContentFromYou = meta.story({
  args: { id: invalidContentOutbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required value is empty' }),
    ).toBeVisible()
    await expect(canvas.getByText('You fix this')).toBeVisible()
    const link = canvas.getByRole('link', { name: /at this field$/ })
    await expect(link.getAttribute('href')).toMatch(
      /^\/mappings\/[\w-]+\?field=(buyer|supplier)\.gln$/,
    )
  },
})

export const MissingCode = meta.story({
  args: { id: missingCode.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The code “KRT” has no translation' }),
    ).toBeVisible()
    const link = canvas.getByRole('link', { name: 'Add KRT to “Units of measure”' })
    await expect(link.getAttribute('href')).toMatch(/^\/code-translations\/[\w-]+\?code=KRT&run=/)
    await expect(link.getAttribute('href')).toContain(`run=${missingCode.id}`)
  },
})

export const MissingField = meta.story({
  args: { id: missingField.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required field is empty' }),
    ).toBeVisible()
    await expect(canvas.getByText(/reads the field “lines\[\]\.gtin”/)).toBeVisible()
    const link = canvas.getByRole('link', { name: /at this field$/ })
    await expect(link.getAttribute('href')).toMatch(/\?field=lines%5B%5D\.gtin$/)
  },
})

export const WithoutFixTarget = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...runDetailHandlers(apiUrl, { runs, lookupTables: createLookupTableStore([]) }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A code has no translation' }),
    ).toBeVisible()
    await expect(canvas.queryByText('Fix the cause.')).toBeNull()
    await expect(await canvas.findByRole('button', { name: 'Process again' })).toBeVisible()
  },
})

export const DeliveryFailure = meta.story({
  args: { id: unreachableOutbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: `The server of ${partner.name} did not answer` }),
    ).toBeVisible()
    await expect(canvas.getByText('Just try again')).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Check the connection “${channel.name}”` }),
      `/channels/${channel.id}`,
    )
  },
})

export const DeliveryFailureToErp = meta.story({
  args: { id: unreachableInbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Your ERP did not answer' }),
    ).toBeVisible()
  },
})

export const IncompleteSetup = meta.story({
  args: { id: incompleteSetup.id },
  beforeEach({ msw }) {
    msw.use(
      servingIncompleteSetup({
        error: {
          code: 'glnMissing',
          message: 'The Workspace has no GLN for the Interchange',
          position: null,
          details: null,
        },
        fixTarget: { kind: 'workspaceGln', name: seedWorkspace.name },
      }),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: `The setup for ${partner.name} is not complete`,
      }),
    ).toBeVisible()
    await expect(canvas.getByText("your company's GLN is missing", { exact: false })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: "Record your company's GLN" }),
      '/settings',
    )
  },
})

export const GermanIncompleteSetup = meta.story({
  args: { id: incompleteSetup.id },
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(
      servingIncompleteSetup({
        error: {
          code: 'channelDefect',
          message: 'The Channel could not be used for the delivery',
          position: null,
          details: null,
        },
        fixTarget: { kind: 'channelCredential', channelId: channel.id, name: channel.name },
      }),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: `Die Einrichtung für ${partner.name} ist nicht vollständig`,
      }),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Zugangsdaten von „${channel.name}“ prüfen` }),
      `/channels/${channel.id}`,
    )
  },
})

export const UnsupportedCharacterSet = meta.story({
  args: { id: incompleteSetup.id },
  beforeEach({ msw }) {
    msw.use(
      servingIncompleteSetup({
        error: {
          code: 'characterSetUnsupported',
          message: 'Delivery in character set UNOD is not supported',
          position: null,
          details: null,
        },
        fixTarget: {
          kind: 'tradingPartner',
          tradingPartnerId: partner.id,
          name: partner.name,
        },
      }),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: `The setup for ${partner.name} is not complete`,
      }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        `Choose a supported character set (UNOA, UNOB or UNOC) for ${partner.name}, then try again.`,
        { exact: false },
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Open ${partner.name}` }),
      `/trading-partners/${partner.id}`,
    )
  },
})

export const Delivered = meta.story({
  args: { id: delivered.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'All good, nothing to do' }),
    ).toBeVisible()
    await expect(canvas.getByText('Received', { selector: 'span:has(> time)' })).toBeVisible()
    await expect(
      canvas.getByText(
        `This purchase order from ${partner.name} was translated and passed to your ERP.`,
      ),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `View the whole order ${delivered.businessReference}` }),
      `/orders/${delivered.businessReference}`,
    )
    await expect(canvas.queryByText('uploaded by hand', { exact: false })).toBeNull()
  },
})

export const UploadedByHand = meta.story({
  args: { id: uploaded.id },
  async play({ canvas }) {
    await expect(await canvas.findByText('· uploaded by hand', { exact: false })).toBeVisible()
  },
})

export const InProgress = meta.story({
  args: { id: processing.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Still being processed' }),
    ).toBeVisible()
  },
})

export const Received = meta.story({
  args: { id: received.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Still being processed' }),
    ).toBeVisible()
  },
})

export const Duplicate = meta.story({
  args: { id: duplicate.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: 'Received twice, ignored to avoid a double order',
      }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        `${partner.name} sent this file a second time. EDI Bridge recognised it and did not pass it on again, so your ERP has only one order ${duplicate.businessReference}.`,
      ),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: 'Open the original document' }),
      `/documents/${original.id}`,
    )
  },
})

export const DuplicateFromErp = meta.story({
  args: { id: duplicateFromErp.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', {
        name: 'Created twice, ignored to avoid a double order',
      }),
    ).toBeVisible()
    await expect(canvas.getByText(/^Your ERP created this document a second time\./)).toBeVisible()
  },
})

export const Loading = meta.story({
  args: { id: delivered.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading document')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  args: { id: delivered.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '40000000-0000-4000-8000-999999999999' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Document not found')).toBeVisible()
    await expectFixLink(canvas.getByRole('link', { name: 'Back to all documents' }), '/documents')
  },
})

export const ProcessAgain = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(false))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        'Process it again. EDI Bridge uses the original file, so your ERP does not have to send anything again.',
      ),
    ).toBeVisible()
    const version = await canvas.findByRole('combobox', { name: 'Version' })
    await expect(version).toBeEnabled()
    await expect(canvas.queryByText(/has unpublished changes/)).toBeNull()

    await userEvent.click(version)
    const options = await screen.findAllByRole('option')
    await expect(options[0]).toHaveTextContent(/\(newest/)
    await expect(options.some((option) => /used before\)$/.test(option.textContent))).toBe(true)
    await userEvent.keyboard('{Escape}')

    await userEvent.click(canvas.getByRole('button', { name: 'Process again' }))
    await expect(
      await canvas.findByText('This document was processed again. The new attempt replaces it.'),
    ).toBeVisible()
    await expect(canvas.getByText('Processing again')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Process again' })).toBeNull()
    const links = canvas.getAllByRole('link', { name: 'Open the new attempt' })
    await expect(links).toHaveLength(1)
    await expect(links[0]!.getAttribute('href')).toMatch(/^\/documents\/[\w-]+$/)
    await expect(links[0]!.getAttribute('href')).not.toBe(`/documents/${missingCode.id}`)
  },
})

const missingCodeVersionsPath = `${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId: invoicMappingId })}`

export const VersionsLoading = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(
      ...invoicMappingDraft(false),
      http.get(missingCodeVersionsPath, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    const loading = await canvas.findByText('Loading versions…')
    await expect(loading).toBeVisible()
    await expect(loading.closest('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByRole('combobox', { name: 'Version' })).toBeNull()
  },
})

export const NoPublishedVersions = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(
      ...invoicMappingDraft(false),
      http.get(missingCodeVersionsPath, () => HttpResponse.json([])),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        `“${invoicMapping.name}” has no published version yet. Publish it first, then process this document again.`,
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Version' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Process again' })).toBeNull()
  },
})

export const GermanNoPublishedVersions = meta.story({
  args: { id: missingCode.id },
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(
      ...invoicMappingDraft(false),
      http.get(missingCodeVersionsPath, () => HttpResponse.json([])),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(`„${invoicMapping.name}“ hat noch keine veröffentlichte Version.`, {
        exact: false,
      }),
    ).toBeVisible()
  },
})

export const WithoutFixTargetOrVersion = meta.story({
  args: { id: missingField.id },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${toPath(runEndpoint.path, { id: missingField.id })}`, () =>
        HttpResponse.json({
          ...missingFieldDetail,
          mappingVersion: null,
          problem: { ...missingFieldDetail.problem, fixTarget: null },
        }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required field is empty' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(
        'Fix the cause described here. EDI Bridge cannot process this document again, so send it again from your ERP.',
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Process again' })).toBeNull()
  },
})

export const TabletProcessAgain = meta.story({
  ...tablet,
  decorators: [besideSidebar],
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(false))
  },
  async play({ canvas, canvasElement }) {
    const version = await canvas.findByRole('combobox', { name: 'Version' })
    await expectNoPageScroll(canvasElement)
    const card = version.closest('[data-slot="card"]')!
    await expect(version.getBoundingClientRect().right).toBeLessThanOrEqual(
      card.getBoundingClientRect().right,
    )
  },
})

export const UnpublishedChanges = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(true))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(`“${invoicMapping.name}” has unpublished changes.`, {
        exact: false,
      }),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: `Open “${invoicMapping.name}”` }),
      `/mappings/${invoicMappingId}`,
    )
  },
})

export const ProcessAgainFailed = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(false), failing(reprocessRunEndpoint.path))
  },
  async play({ canvas }) {
    const button = await canvas.findByRole('button', { name: 'Process again' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Processing again did not start. Try again.',
    )
  },
})

export const ProcessedAgain = meta.story({
  args: { id: replaced.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('This document was processed again. The new attempt replaces it.'),
    ).toBeVisible()
    await expectFixLink(
      canvas.getByRole('link', { name: 'Open the new attempt' }),
      `/documents/${replacing.id}`,
    )
    await expect(canvas.queryByRole('button', { name: 'Process again' })).toBeNull()
  },
})

export const TryAgain = meta.story({
  args: { id: unreachableOutbound.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        'Try again. The finished document is sent once more, nothing is translated again.',
      ),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(
      await canvas.findByRole('heading', { name: 'All good, nothing to do' }),
    ).toBeVisible()
    await expect(canvas.queryByText('Delivering again')).toBeNull()
  },
})

const unreachableOutboundPath = `${apiUrl}${toPath(runEndpoint.path, { id: unreachableOutbound.id })}`

function retryAnswers(change: (run: RunDetail) => RunDetail) {
  return http.post(`${apiUrl}${retryRunEndpoint.path}`, async () => {
    const run = runDetailSchema.parse(await (await fetch(unreachableOutboundPath)).json())

    return HttpResponse.json(change(run))
  })
}

export const TryAgainPending = meta.story({
  args: { id: unreachableOutbound.id },
  beforeEach({ msw }) {
    msw.use(
      retryAnswers((run) =>
        runDetailSchema.parse({
          ...run,
          status: 'processing',
          failureStage: null,
          error: null,
          problem: null,
          waitingForTradingPartnerSince: null,
        }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByText('Delivering again')).toBeVisible()
    await expect(
      canvas.getByText(
        'EDI Bridge is sending the finished document once more. The result appears here.',
      ),
    ).toBeVisible()
  },
})

export const TryAgainFailedAgain = meta.story({
  args: { id: unreachableOutbound.id },
  beforeEach({ msw }) {
    msw.use(retryAnswers((run) => run))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByText('Still not delivered')).toBeVisible()
    await expect(canvas.queryByText('Delivering again')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled()
  },
})

export const TryAgainFailed = meta.story({
  args: { id: unreachableOutbound.id },
  beforeEach({ msw }) {
    msw.use(failing(retryRunEndpoint.path))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The delivery did not start again. Try once more.',
    )
  },
})

export const TellTradingPartner = meta.story({
  args: { id: invalidContentInbound.id },
  beforeEach: stubClipboard,
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `Copy a message for ${partner.name}` }),
    )
    await expect(await canvas.findByRole('button', { name: 'Message copied' })).toBeVisible()
    await expect(writeText).toHaveBeenCalledOnce()
    const message = writeText.mock.calls[0]![0]
    await expect(message).toMatch(new RegExp(`^Hello ${partner.name},\n\nwe could not process`))
    await expect(message).toContain(invalidContentInbound.businessReference)
    await expect(message).toMatch(/control reference \w+\./)
    await expect(message).toMatch(/Technical detail: .+ \(error code \w+/)
  },
})

export const CopyFailed = meta.story({
  args: { id: invalidContentInbound.id },
  beforeEach() {
    const restore = stubClipboard()
    writeText.mockRejectedValueOnce(new Error('Denied'))

    return restore
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `Copy a message for ${partner.name}` }),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The message could not be copied.',
    )
  },
})

export const MarkWaiting = meta.story({
  args: { id: invalidContentInbound.id },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Mark as waiting for partner' }),
    )
    await expect(await canvas.findByRole('button', { name: 'Marked as waiting' })).toBeDisabled()
    await expect(
      canvas.getByText(`Marked as waiting for ${partner.name} since`, { exact: false }),
    ).toBeVisible()
  },
})

export const MarkWaitingFailed = meta.story({
  args: { id: invalidContentInbound.id },
  beforeEach({ msw }) {
    msw.use(failing(waitForTradingPartnerRunEndpoint.path))
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Mark as waiting for partner' }),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The mark was not set. Try again.',
    )
  },
})

export const ViewerProcessAgain = meta.story({
  args: { id: missingCode.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByText('An Admin can process it again.')).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Process again' })).toBeNull()
      await expect(canvas.queryByRole('combobox', { name: 'Version' })).toBeNull()
    },
  }),
})

export const ViewerTryAgain = meta.story({
  args: { id: unreachableOutbound.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByText('An Admin can try again.')).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull()
    },
  }),
})

export const ViewerTellTradingPartner = meta.story({
  args: { id: invalidContentInbound.id },
  ...viewerStory({
    async play({ canvas }) {
      await expect(
        await canvas.findByRole('button', { name: `Copy a message for ${partner.name}` }),
      ).toBeVisible()
      await expect(canvas.getByText('An Admin can mark it.')).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Mark as waiting for partner' })).toBeNull()
    },
  }),
})

export const GermanActions = meta.story({
  args: { id: invalidContentInbound.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('button', { name: `Nachricht für ${partner.name} kopieren` }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Als wartend auf Partner markieren' }),
    ).toBeVisible()
  },
})

export const GermanProcessAgain = meta.story({
  args: { id: missingCode.id },
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(true))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Erneut verarbeiten' })).toBeVisible()
    await expect(
      await canvas.findByText(`„${invoicMapping.name}“ hat unveröffentlichte Änderungen.`, {
        exact: false,
      }),
    ).toBeVisible()
  },
})

export const DarkActions = meta.story({
  args: { id: missingCode.id },
  beforeEach({ msw }) {
    msw.use(...invoicMappingDraft(true))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText(`“${invoicMapping.name}” has unpublished changes.`, {
        exact: false,
      }),
    ).toBeVisible()
  },
})

export const DarkTryAgainFailed = meta.story({
  args: { id: unreachableOutbound.id },
  beforeEach({ msw }) {
    msw.use(failing(retryRunEndpoint.path))

    return darkMode()
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
})

export const German = meta.story({
  args: { id: missingCode.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Für den Code „KRT“ fehlt eine Übersetzung' }),
    ).toBeVisible()
    await expect(canvas.getByText('Sie beheben das')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: missingCode.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'The code “KRT” has no translation' }),
    ).toBeVisible()
  },
})

export const DarkDelivered = meta.story({
  args: { id: delivered.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'All good, nothing to do' }),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  args: { id: missingField.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { name: 'A required field is empty' }),
    ).toBeVisible()
    await expectNoPageScroll(canvasElement)
    const link = canvas.getByRole('link', { name: /at this field$/ })
    const card = link.closest('[data-slot="card"]')!
    await expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
      card.getBoundingClientRect().right,
    )
  },
})

export const GermanMobileActions = meta.story({
  ...mobile,
  decorators: [german],
  args: { id: invalidContentInbound.id },
  async play({ canvas, canvasElement }) {
    const button = await canvas.findByRole('button', {
      name: `Nachricht für ${partner.name} kopieren`,
    })

    await expectNoPageScroll(canvasElement)
    const card = button.closest('[data-slot="card"]')!
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
      card.getBoundingClientRect().right,
    )
  },
})
