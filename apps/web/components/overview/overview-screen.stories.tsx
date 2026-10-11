import { type SetupWorker } from 'msw/browser'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { OverviewScreen } from '@/components/overview/overview-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  createRunStore,
  liveEventsHandler,
  type LiveEventsOptions,
  overviewHandler,
  seedOverviewData,
  seedRuns,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Overview/OverviewScreen',
  component: OverviewScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach() {
    seedRuns()
  },
})

export const Seeded = meta.story({
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Throughput' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Error rate' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Trading Partner health' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Overdue Acknowledgements' })).toBeVisible()
  },
})

export const LastHour = meta.story({
  args: { defaultWindow: '1h' },
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Show values as table')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  args: { defaultWindow: '7d' },
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl, 'large'))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Throughput' }, { timeout: 10_000 }),
    ).toBeVisible()

    const health = canvas.getByRole('region', { name: 'Trading Partner health' })
    const overdue = canvas.getByRole('region', { name: 'Overdue Acknowledgements' })

    await expect(within(health).getAllByRole('row')).toHaveLength(11)
    await expect(within(overdue).getAllByRole('row')).toHaveLength(11)

    await expect(
      within(overdue).getByRole('button', { name: 'Show all 400 Overdue Acknowledgements' }),
    ).toBeVisible()
    await expect(
      within(health).getByRole('button', { name: 'Show all 240 Trading Partners' }),
    ).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No finished Runs')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'No Trading Partners' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'No Overdue Acknowledgements' })).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Overview')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Overview unavailable')).toBeVisible()
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
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Durchsatz' })).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'Zustand der Trading Partners' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'Überfällige Acknowledgements' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(overviewHandler(apiUrl))
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Throughput' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Trading Partner health' })).toBeVisible()
  },
})

function liveStream(options: Omit<LiveEventsOptions, 'runs' | 'signal'>) {
  return ({ msw }: { msw: Pick<SetupWorker, 'use'> }) => {
    const runs = createRunStore(seedRuns())
    const streams = new AbortController()

    msw.use(
      overviewHandler(apiUrl, seedOverviewData(runs)),
      liveEventsHandler(apiUrl, { intervalMs: 1500, ...options, runs, signal: streams.signal }),
    )

    return () => streams.abort()
  }
}

export const Live = meta.story({
  args: { defaultWindow: '1h' },
  beforeEach: liveStream({ mode: 'live' }),
})

export const LiveReconnecting = meta.story({
  args: { defaultWindow: '1h' },
  beforeEach: liveStream({ mode: 'stalling', dropAfter: 0, intervalMs: 300 }),
  async play({ canvas }) {
    await expect(await canvas.findByText('Reconnecting')).toBeVisible()
  },
})

export const LiveOffline = meta.story({
  beforeEach: liveStream({ mode: 'unavailable' }),
})
