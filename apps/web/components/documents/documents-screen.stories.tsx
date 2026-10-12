import { delay, http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'

import { DocumentsScreen } from '@/components/documents/documents-screen'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { runsEndpoint } from '@edi-bridge/contracts'
import { createRuns, runsHandler, seedRuns } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const runs = createRuns({ count: 40 })

const allStatuses = { nextjs: { navigation: { pathname: '/documents', query: { status: 'all' } } } }

const meta = preview.meta({
  title: 'Documents/DocumentsScreen',
  component: DocumentsScreen,
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: '/documents', query: {} } },
  },
})

export const Default = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: /^What to do/ }).length).toBeGreaterThan(0)
  },
})

export const AllStatuses = meta.story({
  parameters: allStatuses,
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('40 documents')).toBeVisible()
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
    await expect(canvas.getByText('Loading documents')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Documents unavailable')).toBeVisible()
  },
})

export const NoDocuments = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, []))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No documents yet')).toBeVisible()
  },
})

export const NothingNeedsAttention = meta.story({
  beforeEach({ msw }) {
    msw.use(
      runsHandler(
        apiUrl,
        runs.filter((run) => run.status !== 'failed'),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Nothing needs your attention')).toBeVisible()
  },
})

export const NothingMatches = meta.story({
  parameters: {
    nextjs: { navigation: { pathname: '/documents', query: { status: 'all', q: 'PO-none' } } },
  },
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No documents match')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2)
  },
})

export const LargeVolume = meta.story({
  parameters: allStatuses,
  beforeEach({ msw }) {
    // Building the 12,000 seeded Runs takes longer than findByText waits on a slow CI runner.
    seedRuns()
    msw.use(runsHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('12,000 documents')).toBeVisible()
    await expect(canvas.getByText('Page 1 of 240')).toBeVisible()
  },
})

export const German = meta.story({
  parameters: allStatuses,
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('40 Belege')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
  },
})
