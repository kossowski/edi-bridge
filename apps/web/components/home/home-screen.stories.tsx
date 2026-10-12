import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { type SetupWorker } from 'msw/browser'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { HomeScreen } from '@/components/home/home-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { everyKind, hansemarkt } from '@/components/tasks/task-story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createRunStore,
  firstStepsHandler,
  homeHandler,
  liveEventsHandler,
  type LiveEventsOptions,
  seedRuns,
  seedWorkspaceActivity,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Home/HomeScreen',
  component: HomeScreen,
  parameters: { layout: 'fullscreen' },
})

function keyNumbers(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole('region', { name: 'Key numbers' }))
}

export const Seeded = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl), firstStepsHandler(apiUrl))
  },
  async play({ canvas }) {
    const documents = await canvas.findByRole('heading', { name: 'Documents' })
    const promo = await canvas.findByRole('region', { name: 'Let the AI draft your next mapping' })

    await expect(documents).toBeVisible()
    await expect(
      within(promo).getByRole('button', { name: 'Draft a mapping with AI' }),
    ).toBeEnabled()
    await expect(
      canvas.getByRole('region', { name: 'Key numbers' }).compareDocumentPosition(promo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(
      promo.compareDocumentPosition(documents) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(canvas.getByRole('heading', { name: 'Share that failed' })).toBeVisible()
    await expect(canvas.getByText('Show values as table')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Your trading partners' })).toBeVisible()
    await expect(canvas.queryByRole('link', { name: /Continue setup/ })).toBeNull()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const ContinueSetup = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'empty'), firstStepsHandler(apiUrl, 'partlyDone'))
  },
  async play({ canvas }) {
    const setup = await canvas.findByRole('link', { name: /^Continue setup\s*3 of 6 done$/ })

    await expect(setup).toHaveAttribute('href', '/first-steps')
    await expect(
      setup.compareDocumentPosition(canvas.getByRole('region', { name: 'Key numbers' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const FreshWorkspace = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'empty'), firstStepsHandler(apiUrl, 'fresh'))
  },
  async play({ canvas }) {
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/first-steps'))
    await expect(canvas.getByText('Loading Home')).toBeInTheDocument()
    await expect(canvas.queryByText('No trading partners yet')).toBeNull()
    await expect(canvas.queryByText('No finished documents')).toBeNull()
  },
})

export const FirstStepsUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl), firstStepsHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Documents' })).toBeVisible()
    await expect(canvas.queryByRole('link', { name: /Continue setup/ })).toBeNull()
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const KeyNumbers = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, everyKind()))
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('link', { name: /^Needs attention\s*Needs you\s*3/ })

    const numbers = keyNumbers(canvasElement)

    await expect(
      numbers.getByRole('link', { name: /^Needs attention\s*Needs you\s*3\s*Open tasks for you/ }),
    ).toHaveAttribute('href', '/tasks#for-you')
    await expect(
      numbers.getByRole('link', { name: /^Delivered in 24 hours\s*12\s*3 failed/ }),
    ).toHaveAttribute('href', '/documents?status=done')
    await expect(
      numbers.getByRole('link', { name: /^In progress\s*0\s*Show documents/ }),
    ).toHaveAttribute('href', '/documents?status=progress')
    await expect(
      numbers.getByRole('link', { name: /^Waiting for a partner\s*2\s*Show who/ }),
    ).toHaveAttribute('href', '/tasks#waiting-for-partner')

    const tradingPartners = within(canvas.getByRole('region', { name: 'Your trading partners' }))

    await expect(
      tradingPartners.getByRole('link', { name: /^Hansemarkt GmbH\s*Live.*4 open problems$/ }),
    ).toHaveAttribute('href', `/trading-partners/${hansemarkt.id}`)
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    handlers: [homeHandler(apiUrl)],
    async play({ canvas }) {
      await expect(await canvas.findByRole('heading', { name: 'Documents' })).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'Draft a mapping with AI' })).toBeNull()
    },
  }),
})

export const SwitchWindow = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl))
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Documents' })
    await userEvent.click(canvas.getByRole('button', { name: '30 days' }))

    await expect(
      await keyNumbers(canvasElement).findByRole('link', { name: /^Delivered in 30 days/ }),
    ).toBeVisible()
    await expect(await canvas.findByText('Delivered and failed documents per day')).toBeVisible()
  },
})

export const SevenDays = meta.story({
  args: { defaultWindow: '7d' },
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Delivered and failed documents per day')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { defaultWindow: '30d' },
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'large'))
  },
  async play({ canvas }) {
    const tradingPartners = await canvas.findByRole(
      'region',
      { name: 'Your trading partners' },
      { timeout: 10_000 },
    )

    await expect(
      await within(tradingPartners).findByRole(
        'link',
        { name: 'Show all 240 trading partners' },
        { timeout: 10_000 },
      ),
    ).toHaveAttribute('href', '/trading-partners')
    await expect(
      within(tradingPartners).getAllByRole('link', { name: /open problem/ }),
    ).toHaveLength(8)
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No finished documents')).toBeVisible()
    await expect(canvas.getByText('No trading partners yet')).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /^Needs attention\s*0\s*Nothing to fix/ }),
    ).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Home')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: /^Needs attention/ })).toHaveAttribute(
      'href',
      '/tasks#for-you',
    )
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Home unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, everyKind()), firstStepsHandler(apiUrl, 'partlyDone'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Belege' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Ihre Handelspartner' })).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Mapping mit KI entwerfen' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('link', { name: /^Handlungsbedarf\s*Braucht Sie\s*3/ }),
    ).toHaveAttribute('href', '/tasks#for-you')
    await expect(
      canvas.getByRole('link', { name: /^Einrichtung fortsetzen\s*3 von 6 erledigt$/ }),
    ).toHaveAttribute('href', '/first-steps')
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, everyKind()), firstStepsHandler(apiUrl, 'partlyDone'))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Documents' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Your trading partners' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(homeHandler(apiUrl, everyKind()), firstStepsHandler(apiUrl, 'partlyDone'))
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('heading', { name: 'Documents' })
    await expect(canvas.getByRole('link', { name: /^Continue setup/ })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

function liveStream(options: Omit<LiveEventsOptions, 'runs' | 'signal'>) {
  return ({ msw }: { msw: Pick<SetupWorker, 'use'> }) => {
    const runs = createRunStore(seedRuns())
    const streams = new AbortController()

    msw.use(
      homeHandler(apiUrl, seedWorkspaceActivity(runs)),
      liveEventsHandler(apiUrl, { intervalMs: 1500, ...options, runs, signal: streams.signal }),
    )

    return () => streams.abort()
  }
}

export const Live = meta.story({
  beforeEach: liveStream({ mode: 'live' }),
})

export const LiveReconnecting = meta.story({
  beforeEach: liveStream({ mode: 'stalling', dropAfter: 0, intervalMs: 300 }),
  async play({ canvas }) {
    await expect(await canvas.findByText('Reconnecting')).toBeVisible()
  },
})

export const LiveOffline = meta.story({
  beforeEach: liveStream({ mode: 'unavailable' }),
})
