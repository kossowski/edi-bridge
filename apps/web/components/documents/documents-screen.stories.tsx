import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DocumentsScreen } from '@/components/documents/documents-screen'
import {
  besideSidebar,
  darkMode,
  german,
  goBack,
  mobile,
  tablet,
  withMemoryHistory,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { runsEndpoint } from '@edi-bridge/contracts'
import { createHandlers, createRuns, runsHandler, seedMappings, seedRuns } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const runs = createRuns({ count: 40 })

const incompleteSetupRuns = createRuns({ count: 200 }).filter(
  ({ problem }) => problem?.reason === 'incompleteSetup',
)

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

export const BackUndoesStatusFilter = meta.story({
  decorators: [withMemoryHistory],
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: /^All\b/ }))
    await expect(await canvas.findByText('40 documents')).toBeVisible()

    goBack()

    await expect(
      await canvas.findByRole('button', { name: /^Needs attention\b/, pressed: true }),
    ).toBeVisible()
  },
})

const narrowedToMapping = {
  nextjs: {
    navigation: {
      pathname: '/documents',
      query: { status: 'attention', mapping: seedMappings[0]!.mappingId },
    },
  },
}

export const NarrowedToMapping = meta.story({
  parameters: narrowedToMapping,
  decorators: [withMemoryHistory],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
  async play({ canvas }) {
    const mapping = await canvas.findByRole('button', {
      name: /^Mapping: Purchase orders from .+, remove filter$/,
    })

    await expect(mapping).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /^Needs attention\b/, pressed: true }),
    ).toBeVisible()
    await expect(
      (await canvas.findAllByRole('link', { name: /^What to do/ })).length,
    ).toBeGreaterThan(0)
    const narrowed = (await canvas.findByText(/^[\d,]+ documents?$/)).textContent

    await userEvent.click(mapping)
    await waitFor(() => expect(canvas.queryByRole('button', { name: /^Mapping:/ })).toBeNull())
    await waitFor(() =>
      expect(canvas.getByText(/^[\d,]+ documents?$/).textContent).not.toBe(narrowed),
    )

    goBack()

    await expect(await canvas.findByRole('button', { name: /^Mapping:/ })).toBeVisible()
  },
})

export const NarrowedToMappingGerman = meta.story({
  parameters: narrowedToMapping,
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('button', {
        name: /^Mapping: Bestellungen von .+, Filter entfernen$/,
      }),
    ).toBeVisible()
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

export const IncompleteSetup = meta.story({
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, incompleteSetupRuns))
  },
  async play({ canvas }) {
    const badges = await canvas.findAllByText('Complete the setup')

    await expect(badges).toHaveLength(incompleteSetupRuns.length)
    await expect(canvas.queryByText('Just try again')).toBeNull()
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

export const FirstPageReplacesEntry = meta.story({
  parameters: {
    nextjs: { navigation: { pathname: '/documents', query: { status: 'all', page: '99999' } } },
  },
  decorators: [withMemoryHistory],
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Go to the first page' }))

    await waitFor(() => expect(canvas.queryByText('This page is empty')).toBeNull())
    await expect(getRouter().replace).toHaveBeenCalledOnce()
    await expect(getRouter().push).not.toHaveBeenCalled()
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

// Only a scroller may be wider than its box; a wider wrapper lets the screen move sideways.
function overflowingWrappers(canvasElement: HTMLElement) {
  return [...canvasElement.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const { overflowX } = getComputedStyle(element)

    const overflows =
      element.scrollWidth > element.clientWidth &&
      overflowX !== 'auto' &&
      overflowX !== 'scroll' &&
      !element.classList.contains('sr-only') &&
      !element.classList.contains('truncate')

    return overflows ? [selectorOf(element)] : []
  })
}

function selectorOf(element: HTMLElement) {
  const { slot } = element.dataset

  if (slot) return `${element.localName}[data-slot="${slot}"]`

  return [element.localName, ...element.classList].join('.')
}

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
    await expectRowsStacked(canvasElement)
    await expect(overflowingWrappers(canvasElement)).toEqual([])
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
