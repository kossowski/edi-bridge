import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { DocumentsScreen } from '@/components/documents/documents-screen'
import { besideSidebar, darkMode, german, mobile, tablet } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { interchangesEndpoint } from '@edi-bridge/contracts'
import { createRuns, interchangesHandler, runsHandler, seedRuns } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const runs = createRuns({ count: 40 })

const transmissionsAt = (query: { q?: string; page?: string } = {}) => ({
  nextjs: { navigation: { pathname: '/documents', query: { view: 'transmissions', ...query } } },
})

const meta = preview.meta({
  title: 'Documents/TransmissionsView',
  component: DocumentsScreen,
  parameters: { layout: 'fullscreen', ...transmissionsAt() },
})

const transmissionCount = /^\d+ transmissions?$/

export const Default = meta.story({
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(transmissionCount)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Transmissions' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.queryByRole('group', { name: 'Status' })).toBeNull()
    await expect(canvas.getByText(/A transmission is one file/)).toBeVisible()

    const list = canvas.getByRole('list', { name: 'Transmissions, newest first' })

    await expect(within(list).getAllByText(/^File (from|to) /).length).toBeGreaterThan(0)
    await expect(within(list).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/runs\//),
    )
  },
})

export const SwitchesViewKeepingFilters = meta.story({
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/documents',
        query: { view: 'documents', status: 'all', q: 'Hanse' },
      },
    },
  },
  beforeEach({ msw }) {
    msw.use(runsHandler(apiUrl, runs), interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ documents?$/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Transmissions' }))
    await expect(await canvas.findByText(transmissionCount)).toBeVisible()
    await expect(
      canvas.getByRole('searchbox', { name: 'Search file number, order number or partner' }),
    ).toHaveValue('Hanse')
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${interchangesEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading transmissions')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${interchangesEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Transmissions unavailable')).toBeVisible()
  },
})

export const NoTransmissions = meta.story({
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, []))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No transmissions yet')).toBeVisible()
  },
})

export const NothingMatches = meta.story({
  parameters: transmissionsAt({ q: 'none-such' }),
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No transmissions match')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2)
  },
})

export const PageOutOfRange = meta.story({
  parameters: transmissionsAt({ page: '99999' }),
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('This page is empty')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Go to the first page' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    // Building the 12,000 seeded Runs takes longer than findByText waits on a slow CI runner.
    seedRuns()
    msw.use(interchangesHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d{1,3}(,\d{3})+ transmissions$/)).toBeVisible()
    await expect(canvas.getByText(/^Page 1 of \d+$/)).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ Übertragungen?$/)).toBeVisible()
    await expect(canvas.getAllByText(/^Datei (von|an) /).length).toBeGreaterThan(0)
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(transmissionCount)).toBeVisible()
  },
})

async function expectNoOverflow(canvasElement: HTMLElement) {
  await within(canvasElement).findByRole('list', { name: 'Transmissions, newest first' })
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(transmissionCount)).toBeVisible()
    await expectNoOverflow(canvasElement)
  },
})

export const Tablet = meta.story({
  ...tablet,
  decorators: [besideSidebar],
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(transmissionCount)).toBeVisible()
    await expectNoOverflow(canvasElement)
  },
})

export const GermanTablet = meta.story({
  ...tablet,
  decorators: [german, besideSidebar],
  beforeEach({ msw }) {
    msw.use(interchangesHandler(apiUrl, runs))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(/^\d+ Übertragungen?$/)).toBeVisible()

    const search = canvas.getByRole('searchbox', {
      name: 'Datei-, Bestellnummer oder Partner suchen',
    })

    const style = getComputedStyle(search)
    const context = document.createElement('canvas').getContext('2d')

    if (!context) {
      throw new Error('No canvas context')
    }

    context.font = style.font

    const textWidth =
      search.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)

    await expect(
      context.measureText(search.getAttribute('placeholder') ?? '').width,
    ).toBeLessThanOrEqual(textWidth)
  },
})
