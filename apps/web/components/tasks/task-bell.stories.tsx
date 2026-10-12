import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { darkMode, german, mobile } from '@/components/story-helpers'
import { TaskBell } from '@/components/tasks/task-bell'
import { everyKind, hansemarkt } from '@/components/tasks/task-story-helpers'
import { apiUrl } from '@/lib/api/config'
import { tasksHandler } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

async function openBell(name: string | RegExp) {
  const bell = await screen.findByRole('button', { name }, { timeout: 10_000 })

  await userEvent.click(bell)
  const popover = await screen.findByRole('dialog')

  await waitFor(() => expect(popover).toBeVisible())

  return popover
}

const meta = preview.meta({
  title: 'Tasks/TaskBell',
  component: TaskBell,
  parameters: { a11y: { context: 'body' } },
  decorators: [
    (Story) => (
      <div className="flex justify-end p-4">
        <Story />
      </div>
    ),
  ],
})

export const EveryKind = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('5')).toBeVisible()
    const popover = await openBell('Tasks, 5 open')

    await expect(
      within(popover).getByText('2 for you to fix · 1 to try again · 2 waiting for a partner'),
    ).toBeVisible()
    await expect(within(popover).getAllByRole('listitem')).toHaveLength(5)
    await expect(
      within(popover).getByRole('link', { name: /^Many documents with Hansemarkt GmbH fail/ }),
    ).toHaveAttribute('href', `/trading-partners/${hansemarkt.id}`)
    await expect(
      within(popover).getByRole('link', { name: /^Rheinkauf eG has not confirmed receipt/ }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/documents\?view=transmissions&q=\d+$/))
    await expect(within(popover).getByRole('link', { name: 'Open all tasks' })).toHaveAttribute(
      'href',
      '/tasks',
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
})

export const Seeded = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl))
  },
  async play() {
    const popover = await openBell(/^Tasks, \d+ open$/)

    await expect(within(popover).getAllByRole('listitem').length).toBeGreaterThan(0)
  },
})

export const AllGood = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    const popover = await openBell('Tasks, nothing open')

    await expect(canvas.queryByText('0')).toBeNull()
    await expect(within(popover).getByText('Nothing needs you')).toBeVisible()
    await expect(within(popover).getByRole('link', { name: 'Open all tasks' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'large'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('99+', {}, { timeout: 10_000 })).toBeVisible()
    const popover = await openBell('Tasks, 99+ open')

    await expect(within(popover).getAllByRole('listitem')).toHaveLength(6)
    await expect(within(popover).getByText(/^Showing the newest 6 of \d+$/)).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    const popover = await openBell('Tasks')

    await expect(canvas.queryByText(/^\d+\+?$/)).toBeNull()
    await expect(within(popover).getByText('Loading tasks')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await waitFor(() => expect(canvas.queryByText(/^\d+\+?$/)).toBeNull())
    const popover = await openBell('Tasks')

    await expect(await within(popover).findByText(/^The tasks could not be loaded/)).toBeVisible()
    await expect(within(popover).getByRole('link', { name: 'Open all tasks' })).toHaveAttribute(
      'href',
      '/tasks',
    )
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play() {
    const popover = await openBell('Aufgaben, 5 offen')

    await expect(
      within(popover).getByRole('link', { name: /^Rheinkauf eG hat den Empfang nicht bestätigt/ }),
    ).toBeVisible()
    await expect(within(popover).getByRole('link', { name: 'Alle Aufgaben öffnen' })).toBeVisible()
  },
})

export const GermanAllGood = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'empty'))
  },
  async play() {
    const popover = await openBell('Aufgaben, nichts offen')

    await expect(within(popover).getByText('Nichts braucht Sie')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))

    return darkMode()
  },
  async play() {
    const popover = await openBell('Tasks, 5 open')

    await expect(within(popover).getAllByRole('listitem')).toHaveLength(5)
  },
})

export const DarkLargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'large'))

    return darkMode()
  },
  async play() {
    const popover = await openBell('Tasks, 99+ open')

    await expect(within(popover).getAllByRole('listitem')).toHaveLength(6)
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvasElement }) {
    const popover = await openBell('Tasks, 5 open')
    const page = canvasElement.ownerDocument.documentElement

    await expect(popover.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    await expect(popover.getBoundingClientRect().right).toBeLessThanOrEqual(page.clientWidth)
  },
})
