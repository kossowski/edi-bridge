import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { darkMode, german } from '@/components/story-helpers'
import { PartnerScreen } from '@/components/trading-partners/partner-screen'
import {
  asViewer,
  at,
  awaiting,
  confirmed,
  live,
  sheetOf,
  untouched,
  withoutGln,
  withPartnerFrame,
} from '@/components/trading-partners/partner-story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  activityDays,
  channelsEndpoint,
  type RunSummary,
  sendTestInterchangeEndpoint,
  testChannelEndpoint,
  testInterchangeRefusedProblem,
  testInterchangeRefusedStatus,
  type TradingPartner,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
} from '@edi-bridge/contracts'
import {
  channelHandlers,
  createChannels,
  createHandlers,
  createWorkspaceActivity,
  createWorkspace,
  seedFlows,
  seedRuns,
  seedTradingPartners,
  tradingPartnerActivityHandlers,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const readyForTest: TradingPartner = {
  ...confirmed,
  onboarding: {
    testInterchangeSentAt: null,
    contrlReceivedAt: null,
    testRejectedAt: null,
    testRejectedRunId: null,
  },
}

const withReadyForTest = seedTradingPartners.map((tradingPartner) =>
  tradingPartner.id === confirmed.id ? readyForTest : tradingPartner,
)

const large = createWorkspaceActivity({
  tradingPartnerCount: 1,
  overdueCount: 60,
  runCount: 4000,
  days: activityDays,
})

const largePartner = large.tradingPartners[0]!

const largeRuns: readonly RunSummary[] = 'all' in large.runs ? large.runs.all() : large.runs

const largeFlows = [
  ...new Map(
    largeRuns.map(({ flow, tradingPartner }) => [
      flow.id,
      { ...flow, tradingPartnerId: tradingPartner.id },
    ]),
  ).values(),
]

// The overview waits for the partner's activity, counted over the whole seeded Run volume, which
// takes a busy CI runner more than the default second.
const activityLoaded = { timeout: 5000 }

function region(canvasElement: HTMLElement, name: string | RegExp) {
  return within(within(canvasElement).getByRole('region', { name }))
}

async function connectionItem(canvasElement: HTMLElement, list: string, way: string) {
  const items = within(await within(canvasElement).findByRole('list', { name: list }))

  return within(items.getByText(way).closest('li')!)
}

// The page refreshes on the live events of the hand-over and the CONTRL, which arrives 500 ms later.
const liveUpdate = { timeout: 5000 }

const meta = preview.meta({
  title: 'Trading Partners/PartnerScreen',
  component: PartnerScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [withPartnerFrame],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Live = meta.story({
  ...at(live),
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'Hansemarkt GmbH' }),
    ).toBeInTheDocument()
    await expect(await canvas.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('tab', { name: 'Settings' })).toBeVisible()
    await expect(
      await canvas.findByText(
        'Hansemarkt GmbH is set up and exchanging real documents.',
        {},
        activityLoaded,
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()

    const days = region(canvasElement, 'Documents, last 7 days')
    await expect(days.getAllByRole('listitem')).toHaveLength(7)

    const flows = region(canvasElement, 'What flows with Hansemarkt GmbH')
    await expect(flows.getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/flows\/[\da-f-]+$/),
    )

    const problems = region(canvasElement, /^Open problems \(/)
    const [transmission] = problems.getAllByRole('link', { name: /^Open transmission / })
    await expect(transmission).toHaveAttribute(
      'href',
      `/documents?view=transmissions&q=${transmission!.textContent}`,
    )
  },
})

export const NewPartnerWithoutActivity = meta.story({
  ...at(untouched),
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('progressbar', { name: 'Setup' }, activityLoaded),
    ).toBeVisible()
    await expect(await canvas.findByRole('listitem', { current: 'step' })).toBeVisible()
    await expect(canvas.getByText('No documents in the last 7 days.')).toBeVisible()
    await expect(
      region(canvasElement, 'What flows with Mainfranken Getränke GmbH').getByText(
        /No document routes yet/,
      ),
    ).toBeVisible()
    await expect(canvas.getByText('Nothing needs attention.')).toBeVisible()
  },
})

export const SendTestDocument = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: { handoverDelayMs: 0, contrlDelayMs: null },
      }),
    )
  },
  async play({ canvas }) {
    const current = await canvas.findByRole('listitem', { current: 'step' }, activityLoaded)
    await expect(current).toHaveTextContent('Send a test document')
    await userEvent.click(within(current).getByRole('button', { name: 'Send a test document' }))
    await expect(within(current).getByRole('button', { name: 'Sending…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // The api answers before the hand-over, so the page waits for its live event.
    await expect(
      await canvas.findByText(
        /Waiting for the receipt confirmation from Spreewald Frische GmbH/,
        {},
        liveUpdate,
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Send the test again' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()
  },
})

const [flowWithoutSample] = seedFlows

const refusedForMissingSample = {
  ...at(readyForTest),
  beforeEach({ msw }: StoryContext) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: { refusal: { reason: 'sampleMissing', flow: flowWithoutSample! } },
      }),
    )
  },
}

export const SendRefusedForMissingSample = meta.story({
  ...refusedForMissingSample,
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send a test document' }, activityLoaded),
    )
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent(
      `The document route ${flowWithoutSample!.name} has no example document to send as a test. Add an example document to the data format of this document route.`,
    )
    await expect(
      within(alert).getByRole('link', { name: flowWithoutSample!.name }),
    ).toHaveAttribute('href', `/flows/${flowWithoutSample!.id}`)
  },
})

export const SendRefusedForMissingSampleGerman = meta.story({
  ...refusedForMissingSample,
  decorators: [german],
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Testbeleg senden' }, activityLoaded),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      `Der Belegweg ${flowWithoutSample!.name} hat keinen Beispielbeleg, der als Test gesendet werden kann. Fügen Sie dem Datenformat dieses Belegwegs einen Beispielbeleg hinzu.`,
    )
  },
})

export const SendRefusedWithoutOutboundFlow = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: { refusal: { reason: 'noOutboundFlow' } },
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send a test document' }, activityLoaded),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'No document route sends documents to Spreewald Frische GmbH yet, so there is nothing to send as a test.',
    )
  },
})

export const SendRefusedWhenNotAwaited = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { tradingPartners: withReadyForTest }))
    msw.use(
      http.post(`${apiUrl}${sendTestInterchangeEndpoint.path}`, () =>
        HttpResponse.json(testInterchangeRefusedProblem({ reason: 'notAwaited' }), {
          status: testInterchangeRefusedStatus,
        }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send a test document' }, activityLoaded),
    )
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Spreewald Frische GmbH does not await a test document right now.',
    )
  },
})

export const ConfirmationArrives = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: { handoverDelayMs: 0, contrlDelayMs: 500 },
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send a test document' }, activityLoaded),
    )
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation/, {}, liveUpdate),
    ).toBeVisible()
    await expect(
      await canvas.findByText(
        'The receipt confirmation from Spreewald Frische GmbH arrived. You can go live now.',
        { selector: ':not([role="status"])' },
        liveUpdate,
      ),
    ).toBeVisible()
    const goLive = canvas.getByRole('button', { name: 'Go live' })
    await userEvent.click(goLive)

    const dialog = await within(canvasElement.ownerDocument.body).findByRole('alertdialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )
    await userEvent.tab()
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Go live now' })).toHaveFocus(),
    )
    await userEvent.tab()
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(goLive).toHaveFocus())
  },
})

const [rejectedRun] = seedRuns()

export const TestRejected = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: {
          handoverDelayMs: 0,
          contrlDelayMs: 500,
          rejectingRunId: rejectedRun!.id,
        },
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Send a test document' }, activityLoaded),
    )
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation/, {}, liveUpdate),
    ).toBeVisible()
    await expect(
      await canvas.findByText(
        'Spreewald Frische GmbH rejected the test document.',
        { selector: ':not([role="status"])' },
        liveUpdate,
      ),
    ).toBeVisible()
    const current = canvas.getByRole('listitem', { current: 'step' })
    await expect(within(current).getByRole('link', { name: 'See why' })).toHaveAttribute(
      'href',
      `/documents/${rejectedRun!.id}`,
    )
    await expect(within(current).getByRole('button', { name: 'Send the test again' })).toBeVisible()
    await expect(canvas.queryByText(/Waiting for the receipt confirmation/)).toBeNull()
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Spreewald Frische GmbH rejected the test document.',
    )
  },
})

const rejectedOnLoad: TradingPartner = {
  ...readyForTest,
  onboarding: {
    ...readyForTest.onboarding,
    testInterchangeSentAt: '2026-10-19T09:12:00.000Z',
    testRejectedAt: '2026-10-19T09:14:30.000Z',
    testRejectedRunId: rejectedRun!.id,
  },
}

export const TestRejectedGerman = meta.story({
  ...at(rejectedOnLoad),
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: seedTradingPartners.map((tradingPartner) =>
          tradingPartner.id === rejectedOnLoad.id ? rejectedOnLoad : tradingPartner,
        ),
      }),
    )
  },
  async play({ canvas }) {
    const current = await canvas.findByRole('listitem', { current: 'step' }, activityLoaded)
    await expect(
      within(current).getByText('Spreewald Frische GmbH hat den Testbeleg abgelehnt.'),
    ).toBeVisible()
    await expect(within(current).getByRole('link', { name: 'Grund ansehen' })).toBeVisible()
    await expect(within(current).getByRole('button', { name: 'Test erneut senden' })).toBeVisible()
  },
})

export const AwaitingConfirmation = meta.story({
  ...at(awaiting),
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        /Waiting for the receipt confirmation from Bodensee Handelshaus AG/,
        {},
        activityLoaded,
      ),
    ).toBeVisible()
    await expect(canvas.getByText(/^Test document sent/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Send the test again' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()
  },
})

export const ConfirmedOnLoad = meta.story({
  ...at(confirmed),
  async play({ canvas }) {
    const current = await canvas.findByRole('listitem', { current: 'step' }, activityLoaded)
    await expect(current).toHaveTextContent('Go live')
    await expect(
      within(current).getByText(
        'The receipt confirmation from Spreewald Frische GmbH arrived. You can go live now.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: 'Setup' })).toHaveAttribute(
      'aria-valuetext',
      '6 of 7 steps done',
    )
  },
})

export const GoLive = meta.story({
  ...at(confirmed),
  async play({ canvas, canvasElement }) {
    const body = within(canvasElement.ownerDocument.body)
    const goLive = await canvas.findByRole('button', { name: 'Go live' }, activityLoaded)

    await userEvent.click(goLive)

    const dialog = await body.findByRole('alertdialog', {
      name: 'Take Spreewald Frische GmbH live?',
    })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(goLive).toHaveFocus())

    await userEvent.click(goLive)
    await userEvent.click(await body.findByRole('button', { name: 'Go live now' }))
    await expect(
      await canvas.findByText('Spreewald Frische GmbH is set up and exchanging real documents.'),
    ).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Setup' })).toHaveFocus())
    await expect(canvas.getByText('Live')).toBeVisible()
  },
})

export const WorkspaceWithoutGln = meta.story({
  ...at(untouched),
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { workspace: createWorkspace({ gln: null }) }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: "Record your company's GLN" }, activityLoaded),
    ).toHaveAttribute('href', '/settings')
  },
})

export const PartnerWithoutGln = meta.story({
  ...at(withoutGln),
  async play({ canvas }) {
    await expect(await canvas.findByText('GLN not added yet')).toBeVisible()
    const current = await canvas.findByRole('listitem', { current: 'step' }, activityLoaded)
    await expect(current).toHaveTextContent("The partner's GLN")
    await expect(
      within(current).getByRole('link', { name: "Add the partner's GLN" }),
    ).toHaveAttribute('href', `/trading-partners/${withoutGln.id}?tab=settings`)
  },
})

export const PartnerWithoutGlnGerman = meta.story({
  ...at(withoutGln),
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('GLN noch nicht erfasst')).toBeVisible()
    await expect(
      await canvas.findByRole('link', { name: 'GLN des Partners erfassen' }, activityLoaded),
    ).toBeVisible()
  },
})

export const PartnerWithoutGlnDark = meta.story({
  ...at(withoutGln),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByText('GLN not added yet')).toBeVisible()
  },
})

export const ViewerAwaitingConfirmation = meta.story({
  ...at(awaiting),
  ...asViewer(async ({ canvas }) => {
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation/, {}, activityLoaded),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Send the test again' })).toBeNull()
  }),
})

export const ViewerConfirmedOnLoad = meta.story({
  ...at(confirmed),
  ...asViewer(async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        'The receipt confirmation from Spreewald Frische GmbH arrived. You can go live now.',
        {},
        activityLoaded,
      ),
    ).toBeVisible()
    await expect(await canvas.findByText('An Admin continues the setup.')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()
  }),
})

export const ChooseSettingsTab = meta.story({
  ...at(live),
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Settings' }))
    await expect(getRouter().replace).toHaveBeenCalledWith(
      `/trading-partners/${live.id}?tab=settings`,
      { scroll: false },
    )
    await userEvent.click(canvas.getByRole('tab', { name: 'Overview' }))
    await userEvent.click(canvas.getByRole('tab', { name: 'Settings' }))
    await expect(canvas.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByLabelText('Name')).toHaveValue(live.name)
  },
})

export const UnknownTabShowsOverview = meta.story({
  ...at(live, 'archive'),
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
})

export const Settings = meta.story({
  ...at(awaiting, 'settings'),
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByLabelText('Name')).toHaveValue(awaiting.name)
    await expect(canvas.getByLabelText('GLN')).toHaveValue(awaiting.gln)
    await expect(canvas.getByLabelText('Wait time for a receipt confirmation (hours)')).toHaveValue(
      awaiting.acknowledgementTimeLimitHours,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByText('Changes saved.')).toBeVisible()
  },
})

export const SettingsInvalid = meta.story({
  ...at(awaiting, 'settings'),
  async play({ canvas }) {
    const hours = await canvas.findByLabelText('Wait time for a receipt confirmation (hours)')
    await userEvent.clear(hours)
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(hours).toHaveAttribute('aria-invalid', 'true'))
    await expect(canvas.queryByText('Changes saved.')).toBeNull()
  },
})

export const SettingsAsViewer = meta.story({
  ...at(awaiting, 'settings'),
  ...asViewer(async ({ canvas }) => {
    await expect(await canvas.findByText(awaiting.gln!)).toBeVisible()
    await expect(canvas.getByText('12 hours')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Save changes' })).toBeNull()
  }),
})

export const SettingsWithoutGln = meta.story({
  ...at(withoutGln, 'settings'),
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toHaveValue('')
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByText('Changes saved.')).toBeVisible()
    await expect(canvas.getByText('GLN not added yet')).toBeVisible()
  },
})

export const SettingsClearGln = meta.story({
  ...at(untouched, 'settings'),
  async play({ canvas }) {
    const gln = await canvas.findByLabelText('GLN')
    await userEvent.clear(gln)
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await expect(await canvas.findByText('Changes saved.')).toBeVisible()
    await expect(gln).not.toHaveAttribute('aria-invalid', 'true')
    await expect(await canvas.findByText('GLN not added yet')).toBeVisible()
  },
})

export const SettingsKeepGlnAfterTest = meta.story({
  ...at(awaiting, 'settings'),
  async play({ canvas }) {
    const gln = await canvas.findByLabelText('GLN')
    await userEvent.clear(gln)
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await expect(gln).toHaveAttribute('aria-invalid', 'true')
    await expect(gln).toHaveFocus()
    await expect(
      canvas.getByText(
        'Enter the GLN. Documents exchanged with this partner are addressed with it, so it cannot be removed.',
      ),
    ).toBeVisible()
  },
})

export const SettingsWithoutGlnAsViewer = meta.story({
  ...at(withoutGln, 'settings'),
  ...asViewer(async ({ canvas }) => {
    await expect(await canvas.findByText('Not added yet')).toBeVisible()
  }),
})

export const NotFound = meta.story({
  ...at({ ...live, id: '10000000-0000-4000-8000-0000000000ff' }),
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading partner not found')).toBeVisible()
  },
})

export const NotFoundForAnIdThatIsNoUuid = meta.story({
  ...at({ ...live, id: 'no-such-id' }),
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading partner not found')).toBeVisible()
  },
})

export const Loading = meta.story({
  ...at(live),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnerEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading trading partner')).toBeInTheDocument()
  },
})

export const ActivityLoading = meta.story({
  ...at(live),
  beforeEach({ msw }) {
    msw.use(...tradingPartnerActivityHandlers(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the activity')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  ...at(live),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnerEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading partner unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const ActivityUnavailable = meta.story({
  ...at(live),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${tradingPartnerActivityEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Activity unavailable')).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Settings' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  ...at(largePartner),
  beforeEach({ msw }) {
    msw.use(
      ...tradingPartnerHandlers(apiUrl, { tradingPartners: large.tradingPartners }),
      ...tradingPartnerActivityHandlers(apiUrl, {
        tradingPartners: large.tradingPartners,
        runs: large.runs,
        overdueAcknowledgements: large.overdueAcknowledgements,
        flows: largeFlows,
        channels: [{ tradingPartnerId: largePartner.id }],
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    const problems = await canvas.findByRole(
      'region',
      { name: /^Open problems \(/ },
      activityLoaded,
    )

    await expect(within(problems).getAllByRole('listitem')).toHaveLength(20)
    await expect(within(problems).getByText(/^Showing 20 of/)).toBeVisible()
    await expect(
      within(problems).getByRole('link', { name: 'Show all documents that need attention' }),
    ).toHaveAttribute('href', `/documents?status=attention&partner=${largePartner.id}`)
    await expect(
      region(canvasElement, 'Documents, last 7 days').getAllByRole('listitem'),
    ).toHaveLength(7)
  },
})

export const German = meta.story({
  ...at(confirmed),
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Übersicht' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Einstellungen' })).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Live schalten' }, activityLoaded),
    ).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Belege der letzten 7 Tage' })).toBeVisible()
  },
})

export const GermanSettings = meta.story({
  ...at(awaiting, 'settings'),
  decorators: [german],
  async play({ canvas }) {
    await expect(
      await canvas.findByLabelText('Wartezeit auf eine Empfangsbestätigung (Stunden)'),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  ...at(awaiting),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation/, {}, activityLoaded),
    ).toBeVisible()
  },
})

export const DarkConfirmedOnLoad = meta.story({
  ...at(confirmed),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(
      await canvas.findByText(
        /The receipt confirmation from Spreewald Frische GmbH arrived/,
        {},
        activityLoaded,
      ),
    ).toBeVisible()
  },
})

export const DarkLive = meta.story({
  ...at(live),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/is set up and exchanging real documents/, {}, activityLoaded),
    ).toBeVisible()
  },
})

export const DarkSettings = meta.story({
  ...at(awaiting, 'settings'),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Save changes' })).toBeVisible()
  },
})

export const Connections = meta.story({
  ...at(live, 'connections'),
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Documents',
      'Connections',
      'Settings',
    ])

    const own = await canvas.findByRole('list', { name: 'Connections with Hansemarkt GmbH' })
    await expect(within(own).getByText('Receive from Hansemarkt GmbH')).toBeVisible()
    await expect(within(own).getByText('Send to Hansemarkt GmbH')).toBeVisible()
    await expect(within(own).getByRole('link', { name: 'Hansemarkt SFTP inbox' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/channels\/[\da-f-]+$/),
    )

    const shared = canvas.getByRole('list', { name: 'Shared connections of your systems' })
    await expect(within(shared).getByText('Receive from your systems')).toBeVisible()
    await expect(within(shared).getByText('Send to your systems')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'All connections' })).toHaveAttribute(
      'href',
      '/channels',
    )
  },
})

export const ConnectionsEmpty = meta.story({
  ...at(untouched, 'connections'),
  async play({ canvas }) {
    await expect(await canvas.findByText('No connections yet')).toBeVisible()
    await expect(
      canvas.getByText(/no documents can arrive from Mainfranken Getränke GmbH/),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add a connection' })).toBeVisible()
    await expect(
      canvas.getByRole('list', { name: 'Shared connections of your systems' }),
    ).toBeVisible()
  },
})

export const ConnectionsWithoutAny = meta.story({
  ...at(untouched, 'connections'),
  beforeEach({ msw }) {
    msw.use(...channelHandlers(apiUrl, { channels: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No connections yet')).toBeVisible()
    await expect(canvas.getByText('No shared connections of your systems yet.')).toBeVisible()
  },
})

export const ConnectionsLoading = meta.story({
  ...at(live, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading the connections')).toBeInTheDocument()
  },
})

export const ConnectionsUnavailable = meta.story({
  ...at(live, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Connections unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const ConnectionsLargeVolume = meta.story({
  ...at(live, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      ...channelHandlers(apiUrl, {
        channels: [
          ...createChannels({ count: 120 }).map((channel) => ({
            ...channel,
            tradingPartnerId: live.id,
          })),
          ...createChannels({ count: 40, seed: 7 }).map((channel) => ({
            ...channel,
            tradingPartnerId: null,
          })),
        ],
      }),
    )
  },
  async play({ canvas }) {
    const own = await canvas.findByRole('list', { name: 'Connections with Hansemarkt GmbH' })
    await expect(within(own).getAllByRole('listitem')).toHaveLength(120)
    await expect(
      within(canvas.getByRole('list', { name: 'Shared connections of your systems' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(40)
  },
})

export const ConnectionsAsViewer = meta.story({
  ...at(live, 'connections'),
  ...asViewer(async ({ canvas }) => {
    await expect(
      await canvas.findByRole('list', { name: 'Connections with Hansemarkt GmbH' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Add a connection' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Test connection/ })).toBeNull()
  }),
})

export const TestConnectionSucceeds = meta.story({
  ...at(live, 'connections'),
  async play({ canvasElement }) {
    const item = await connectionItem(
      canvasElement,
      'Connections with Hansemarkt GmbH',
      'Receive from Hansemarkt GmbH',
    )

    await userEvent.click(
      item.getByRole('button', { name: 'Test connection Hansemarkt SFTP inbox' }),
    )
    await expect(await item.findByText('The connection works.')).toBeVisible()
    await expect(item.getByText(/^Tested/)).toBeVisible()
  },
})

export const TestConnectionLoginRejected = meta.story({
  ...at(awaiting, 'connections'),
  async play({ canvasElement }) {
    const item = await connectionItem(
      canvasElement,
      'Connections with Bodensee Handelshaus AG',
      'Send to Bodensee Handelshaus AG',
    )

    await userEvent.click(item.getByRole('button', { name: /^Test connection/ }))
    await expect(await item.findByText('Login was rejected.')).toBeVisible()
    await expect(item.getByText(/Check the username and the password or key/)).toBeVisible()
  },
})

export const TestConnectionPending = meta.story({
  ...at(live, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${testChannelEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvasElement }) {
    const item = await connectionItem(
      canvasElement,
      'Connections with Hansemarkt GmbH',
      'Receive from Hansemarkt GmbH',
    )

    const button = item.getByRole('button', { name: /^Test connection/ })
    await userEvent.click(button)
    await expect(button).toHaveTextContent('Testing…')
    await expect(button).toHaveAttribute('aria-disabled', 'true')
  },
})

export const TestConnectionRequestFails = meta.story({
  ...at(live, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${testChannelEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvasElement }) {
    const item = await connectionItem(
      canvasElement,
      'Connections with Hansemarkt GmbH',
      'Receive from Hansemarkt GmbH',
    )

    await userEvent.click(item.getByRole('button', { name: /^Test connection/ }))
    await expect(await item.findByText('The test could not run. Try again.')).toBeVisible()
  },
})

export const AddConnectionSheet = meta.story({
  ...at(untouched, 'connections'),
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add a connection' }))

    const sheet = within(await sheetOf(canvasElement))
    await expect(sheet.queryByLabelText('Host')).toBeNull()
    await userEvent.click(sheet.getByText('You send to Mainfranken Getränke GmbH'))
    await expect(sheet.getByRole('radio', { name: /To an SFTP folder/ })).toBeChecked()
    await expect(sheet.getByLabelText('Name')).toHaveValue('Mainfranken Getränke GmbH SFTP outbox')
    await waitFor(() => expect(sheet.getByLabelText('Host')).toBeVisible())
    await userEvent.click(sheet.getByText('To a web address of the partner'))
    await expect(sheet.getByLabelText('Name')).toHaveValue(
      'Mainfranken Getränke GmbH HTTP delivery',
    )
    await waitFor(() => expect(sheet.getByLabelText('URL')).toBeVisible())
  },
})

export const AddSftpConnection = meta.story({
  ...at(untouched, 'connections'),
  async play({ canvas, canvasElement }) {
    const add = await canvas.findByRole('button', { name: 'Add a connection' })
    await userEvent.click(add)

    const sheetElement = await sheetOf(canvasElement)
    const sheet = within(sheetElement)
    await userEvent.click(sheet.getByText('Mainfranken Getränke GmbH sends to you'))
    await userEvent.click(sheet.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(sheet.getByLabelText('Host')).toHaveFocus())

    await userEvent.type(sheet.getByLabelText('Host'), 'sftp.mainfranken.example')
    await userEvent.type(sheet.getByLabelText('Username'), 'edi-bridge')
    await userEvent.clear(sheet.getByLabelText('Folder'))
    await userEvent.type(sheet.getByLabelText('Folder'), '/outbox')
    await userEvent.type(sheet.getByLabelText('Password'), 'secret')
    await userEvent.click(sheet.getByRole('button', { name: 'Add connection' }))

    await waitFor(() => expect(sheetElement).not.toBeInTheDocument())
    await expect(
      await canvas.findByText(
        'Mainfranken Getränke GmbH SFTP inbox is added. Test it to make sure it works.',
      ),
    ).toBeVisible()

    const own = await canvas.findByRole('list', {
      name: 'Connections with Mainfranken Getränke GmbH',
    })

    await expect(within(own).getByText('Receive from Mainfranken Getränke GmbH')).toBeVisible()
    await waitFor(() => expect(add).toHaveFocus())
  },
})

export const AddWebhookConnection = meta.story({
  ...at(untouched, 'connections'),
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add a connection' }))

    const sheet = within(await sheetOf(canvasElement))
    await userEvent.click(sheet.getByText('Mainfranken Getränke GmbH sends to you'))
    await userEvent.click(sheet.getByText('To a web address of EDI Bridge'))
    await userEvent.click(sheet.getByRole('button', { name: 'Add connection' }))
    await expect(
      await sheet.findByRole('heading', { name: 'Copy the webhook token now' }),
    ).toBeVisible()
    await expect(sheet.getByText(/^Mainfranken Getränke GmbH webhook is added/)).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible()
  },
})

export const AddConnectionFails = meta.story({
  ...at(untouched, 'connections'),
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add a connection' }))

    const sheet = within(await sheetOf(canvasElement))
    await userEvent.click(sheet.getByText('Mainfranken Getränke GmbH sends to you'))
    await userEvent.click(sheet.getByText('To a web address of EDI Bridge'))
    await userEvent.click(sheet.getByRole('button', { name: 'Add connection' }))
    await expect(
      await sheet.findByText('The connection could not be added. Try again.'),
    ).toBeVisible()
  },
})

export const AddConnectionFromSetup = meta.story({
  ...at(untouched),
  async play({ canvas, canvasElement }) {
    const current = await canvas.findByRole('listitem', { current: 'step' })
    await expect(current).toHaveTextContent('Connections')
    await userEvent.click(within(current).getByRole('button', { name: 'Add a connection' }))
    await expect(getRouter().replace).toHaveBeenCalledWith(
      `/trading-partners/${untouched.id}?tab=connections`,
      { scroll: false },
    )
    await sheetOf(canvasElement)
  },
})

export const GermanConnections = meta.story({
  ...at(awaiting, 'connections'),
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Verbindungen' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const item = await connectionItem(
      canvasElement,
      'Verbindungen mit Bodensee Handelshaus AG',
      'Senden an Bodensee Handelshaus AG',
    )

    await userEvent.click(item.getByRole('button', { name: /^Verbindung testen/ }))
    await expect(await item.findByText('Die Anmeldung wurde abgelehnt.')).toBeVisible()
  },
})

export const GermanAddConnectionSheet = meta.story({
  ...at(untouched, 'connections'),
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Verbindung hinzufügen' }))

    const sheet = within(await sheetOf(canvasElement, 'Verbindung hinzufügen'))

    await userEvent.click(sheet.getByText('Mainfranken Getränke GmbH sendet an Sie'))
    await expect(sheet.getByLabelText('Name')).toHaveValue('Mainfranken Getränke GmbH SFTP-Eingang')
  },
})

export const DarkConnections = meta.story({
  ...at(awaiting, 'connections'),
  beforeEach: darkMode,
  async play({ canvasElement }) {
    const item = await connectionItem(
      canvasElement,
      'Connections with Bodensee Handelshaus AG',
      'Send to Bodensee Handelshaus AG',
    )

    await userEvent.click(item.getByRole('button', { name: /^Test connection/ }))
    await expect(await item.findByText('Login was rejected.')).toBeVisible()
  },
})

export const DarkAddConnectionSheet = meta.story({
  ...at(untouched, 'connections'),
  beforeEach: darkMode,
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add a connection' }))

    const sheet = within(await sheetOf(canvasElement))
    await userEvent.click(sheet.getByText('You send to Mainfranken Getränke GmbH'))
    await waitFor(() => expect(sheet.getByLabelText('Host')).toBeVisible())
  },
})
