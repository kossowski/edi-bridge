import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { AppHeader } from '@/components/app-header'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, german } from '@/components/story-helpers'
import { PartnerScreen } from '@/components/trading-partners/partner-screen'
import { apiUrl } from '@/lib/api/config'
import {
  type RunSummary,
  type TradingPartner,
  tradingPartnerActivityEndpoint,
  tradingPartnerEndpoint,
} from '@edi-bridge/contracts'
import {
  createHandlers,
  createOverviewData,
  createWorkspace,
  seedTradingPartners,
  showcaseViewerSession,
  tradingPartnerActivityHandlers,
  tradingPartnerHandlers,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../../.storybook/preview'

function seeded(name: string) {
  return seedTradingPartners.find((tradingPartner) => tradingPartner.name === name)!
}

const live = seeded('Hansemarkt GmbH')

const confirmed = seeded('Spreewald Frische GmbH')

const awaiting = seeded('Bodensee Handelshaus AG')

const untouched = seeded('Mainfranken Getränke GmbH')

const readyForTest: TradingPartner = {
  ...confirmed,
  onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
}

const withReadyForTest = seedTradingPartners.map((tradingPartner) =>
  tradingPartner.id === confirmed.id ? readyForTest : tradingPartner,
)

const large = createOverviewData({ tradingPartnerCount: 1, overdueCount: 60, runCount: 4000 })

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

function at(tradingPartner: TradingPartner, tab?: string) {
  return {
    args: { id: tradingPartner.id },
    parameters: {
      nextjs: {
        navigation: {
          pathname: `/trading-partners/${tradingPartner.id}`,
          query: tab ? { tab } : {},
        },
      },
    },
  }
}

function asViewer(play: (context: StoryContext) => Promise<void>) {
  return {
    beforeEach({ msw }: StoryContext) {
      msw.use(...sessionHandlers(showcaseViewerSession))
    },
    async play(context: StoryContext) {
      await expect(await context.canvas.findByText('View only')).toBeVisible()
      await play(context)
    },
  }
}

function region(canvasElement: HTMLElement, name: string | RegExp) {
  return within(within(canvasElement).getByRole('region', { name }))
}

const meta = preview.meta({
  title: 'Trading Partners/PartnerScreen',
  component: PartnerScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="w-full">
          <AppHeader />
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
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
      await canvas.findByText('Hansemarkt GmbH is set up and exchanging real documents.'),
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
  },
})

export const NewPartnerWithoutActivity = meta.story({
  ...at(untouched),
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('progressbar', { name: 'Setup' })).toBeVisible()
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
        testInterchange: { contrlDelayMs: null },
      }),
    )
  },
  async play({ canvas }) {
    const current = await canvas.findByRole('listitem', { current: 'step' })
    await expect(current).toHaveTextContent('Send a test document')
    await userEvent.click(within(current).getByRole('button', { name: 'Send a test document' }))
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation from Spreewald Frische GmbH/),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Send the test again' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()
  },
})

export const ConfirmationArrives = meta.story({
  ...at(readyForTest),
  beforeEach({ msw }) {
    msw.use(
      ...createHandlers(apiUrl, {
        tradingPartners: withReadyForTest,
        testInterchange: { contrlDelayMs: 1000 },
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Send a test document' }))
    await expect(await canvas.findByText(/Waiting for the receipt confirmation/)).toBeVisible()
    await expect(
      await canvas.findByText(
        'The receipt confirmation from Spreewald Frische GmbH arrived. You can go live now.',
        { selector: ':not([role="status"])' },
        { timeout: 10_000 },
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Go live' })).toBeVisible()
  },
})

export const AwaitingConfirmation = meta.story({
  ...at(awaiting),
  async play({ canvas }) {
    await expect(
      await canvas.findByText(/Waiting for the receipt confirmation from Bodensee Handelshaus AG/),
    ).toBeVisible()
    await expect(canvas.getByText(/^Test document sent/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Send the test again' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Go live' })).toBeNull()
  },
})

export const ConfirmationArrived = meta.story({
  ...at(confirmed),
  async play({ canvas }) {
    const current = await canvas.findByRole('listitem', { current: 'step' })
    await expect(current).toHaveTextContent('Go live')
    await expect(canvas.getByRole('progressbar', { name: 'Setup' })).toHaveAttribute(
      'aria-valuetext',
      '5 of 6 steps done',
    )
  },
})

export const GoLive = meta.story({
  ...at(confirmed),
  async play({ canvas, canvasElement }) {
    const body = within(canvasElement.ownerDocument.body)
    const goLive = await canvas.findByRole('button', { name: 'Go live' })

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
      await canvas.findByRole('link', { name: "Record your company's GLN" }),
    ).toHaveAttribute('href', '/settings')
  },
})

export const ViewerAwaitingConfirmation = meta.story({
  ...at(awaiting),
  ...asViewer(async ({ canvas }) => {
    await expect(await canvas.findByText(/Waiting for the receipt confirmation/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Send the test again' })).toBeNull()
  }),
})

export const ViewerConfirmationArrived = meta.story({
  ...at(confirmed),
  ...asViewer(async ({ canvas }) => {
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
  },
})

export const UnknownTabShowsOverview = meta.story({
  ...at(live, 'documents'),
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
    await expect(await canvas.findByText(awaiting.gln)).toBeVisible()
    await expect(canvas.getByText('12 hours')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Save changes' })).toBeNull()
  }),
})

export const NotFound = meta.story({
  ...at({ ...live, id: '10000000-0000-4000-8000-0000000000ff' }),
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
    const problems = await canvas.findByRole('region', { name: /^Open problems \(/ })
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
    await expect(await canvas.findByRole('button', { name: 'Live schalten' })).toBeVisible()
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
    await expect(await canvas.findByText(/Waiting for the receipt confirmation/)).toBeVisible()
  },
})

export const DarkLive = meta.story({
  ...at(live),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByText(/is set up and exchanging real documents/)).toBeVisible()
  },
})

export const DarkSettings = meta.story({
  ...at(awaiting, 'settings'),
  beforeEach: darkMode,
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Save changes' })).toBeVisible()
  },
})
