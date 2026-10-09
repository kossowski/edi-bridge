import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { emptyRunFilters, useRunFilters } from '@/components/runs/run-filters-store'
import { RunsScreen } from '@/components/runs/runs-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { runsEndpoint } from '@edi-bridge/contracts'
import { createHandlers, createRuns, runsHandler, seedRuns } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Runs/RunsScreen',
  component: RunsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach() {
    // Building the 12,000 seeded Runs takes longer than findByText waits on a slow CI runner.
    seedRuns()
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

export const ManualSubmission = meta.story({
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
    useRunFilters.setState({ manualSubmission: 'manual' })
  },
  async play({ canvas }) {
    const count = async () =>
      Number((await canvas.findByText(/^[\d,]+ Runs$/)).textContent.replaceAll(/\D/g, ''))

    const before = await count()
    await userEvent.click(canvas.getByRole('button', { name: 'Submit a Document' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Manual Submission' }))
    const trigger = dialog.getByRole('combobox', { name: 'Inbound Channel' })
    await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled'))
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Hansemarkt SFTP inbox' }))
    await userEvent.upload(
      dialog.getByLabelText('Document'),
      new File(['Please ship by Friday.'], 'notes.txt', { type: 'text/plain' }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Submit Document' }))
    await expect(await dialog.findByRole('heading', { name: '1 Run created' })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await expect(canvas.getByRole('button', { name: 'Submit a Document' })).toHaveFocus()
    await waitFor(async () => expect(await count()).toBe(before + 1))
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
    useRunFilters.getState().setTimeRange({
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
