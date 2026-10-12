import { delay, http, HttpResponse } from 'msw'
import { expect, within } from 'storybook/test'

import { DocumentsScreen } from '@/components/documents/documents-screen'
import { besideSidebar, darkMode, german, mobile, tablet } from '@/components/story-helpers'
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

export const PageOutOfRange = meta.story({
  parameters: {
    nextjs: { navigation: { pathname: '/documents', query: { status: 'all', page: '99999' } } },
  },
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('This page is empty')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Go to the first page' })).toBeVisible()
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

async function expectRowsStacked(canvasElement: HTMLElement) {
  const list = await within(canvasElement).findByRole('list', { name: 'Documents, newest first' })
  const row = list.querySelector('li')
  const content = row?.querySelector('[data-slot="item-content"]')

  await expect(content?.getBoundingClientRect().width).toBeGreaterThan(200)
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
    await expectRowsStacked(canvasElement)
  },
})

export const Tablet = meta.story({
  ...tablet,
  decorators: [besideSidebar],
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
    await expectRowsStacked(canvasElement)
  },
})
