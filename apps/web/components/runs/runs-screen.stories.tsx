import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { emptyRunFilters, useRunFilters } from '@/components/runs/run-filters-store'
import { RunsScreen } from '@/components/runs/runs-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { runsEndpoint } from '@edi-bridge/contracts'
import { createRuns, runsHandler } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Runs/RunsScreen',
  component: RunsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach() {
    useRunFilters.setState({ ...emptyRunFilters, page: 1, pageSize: 50 })
  },
})

export const Default = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, createRuns({ count: 40 })))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('40 Runs')).toBeVisible()
    await expect(canvas.getAllByRole('row')).toHaveLength(41)
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('12,000 Runs')).toBeVisible()
    await expect(canvas.getByText('Page 1 of 240')).toBeVisible()
  },
})

export const FilteredByFailureStage = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl))
    useRunFilters.setState({ status: ['failed'], failureStage: ['mapping', 'delivery'] })
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Clear all filters' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, []))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Runs yet')).toBeVisible()
  },
})

export const NoMatches = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, createRuns({ count: 20 })))
    useRunFilters.setState({
      timeRange: 'custom',
      customFrom: '2000-01-01',
      customTo: '2000-01-02',
    })
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No matching Runs')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Runs')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${runsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Runs unavailable')).toBeVisible()
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
    msw.use(runsHandler(apiUrl, createRuns({ count: 40 })))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('40 Runs')).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Quelle' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, createRuns({ count: 40 })))
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('40 Runs')).toBeVisible()
  },
})
