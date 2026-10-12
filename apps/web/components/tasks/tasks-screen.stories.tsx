import { expect, within } from 'storybook/test'

import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { TasksScreen } from '@/components/tasks/tasks-screen'
import { apiUrl } from '@/lib/api/config'
import {
  createOverdueAcknowledgement,
  createRun,
  createTradingPartner,
  emptyTasksData,
  type TasksData,
  tasksHandler,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const hour = 60 * 60 * 1000

const hoursAgo = (hours: number) => new Date(Date.now() - hours * hour).toISOString()

const hansemarkt = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Hansemarkt GmbH',
  testMode: false,
})

const rheinkauf = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000003',
  name: 'Rheinkauf eG',
  testMode: false,
})

function failedRun(
  tradingPartner: typeof hansemarkt,
  messageType: 'ORDERS' | 'DESADV' | 'INVOIC',
  failureStage: 'parse' | 'validation' | 'mapping' | 'delivery',
  hours: number,
) {
  return createRun({
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    messageType,
    status: 'failed',
    failureStage,
    receivedAt: hoursAgo(hours),
  })
}

function deliveredRun(tradingPartner: typeof hansemarkt, hours: number) {
  return createRun({
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    status: 'delivered',
    failureStage: null,
    receivedAt: hoursAgo(hours),
  })
}

function everyKind(): TasksData {
  return {
    ...emptyTasksData,
    tradingPartners: [hansemarkt, rheinkauf],
    runs: [
      failedRun(hansemarkt, 'INVOIC', 'delivery', 1),
      failedRun(hansemarkt, 'DESADV', 'mapping', 2),
      failedRun(hansemarkt, 'ORDERS', 'parse', 3),
      ...Array.from({ length: 12 }, (_, index) => deliveredRun(rheinkauf, index + 1)),
    ],
    overdueAcknowledgements: [
      createOverdueAcknowledgement({
        tradingPartner: { id: rheinkauf.id, name: rheinkauf.name },
        messageType: 'DESADV',
        acknowledgementTimeLimitHours: 24,
        overdueSince: hoursAgo(5),
      }),
    ],
  }
}

const meta = preview.meta({
  title: 'Tasks/TasksScreen',
  component: TasksScreen,
  parameters: { layout: 'fullscreen' },
})

export const EveryKind = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvas }) {
    const you = await canvas.findByRole('region', { name: 'For you to fix (2)' })
    const retry = canvas.getByRole('region', { name: 'Try again (1)' })
    const tradingPartner = canvas.getByRole('region', { name: 'Waiting for a partner (2)' })

    await expect(
      within(you).getByRole('heading', { name: 'Many documents with Hansemarkt GmbH fail' }),
    ).toBeVisible()
    await expect(within(you).getByRole('link', { name: 'Open partner' })).toHaveAttribute(
      'href',
      `/trading-partners/${hansemarkt.id}`,
    )
    await expect(within(you).getByRole('link', { name: 'Fix it' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/runs\//),
    )
    await expect(within(retry).getByRole('link', { name: 'Open and try again' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/runs\//),
    )
    await expect(
      within(tradingPartner).getByRole('heading', {
        name: 'Rheinkauf eG has not confirmed receipt',
      }),
    ).toBeVisible()
    await expect(
      within(tradingPartner).getByRole('link', { name: 'Open transmission' }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/documents\?view=transmissions&q=\d+$/))
  },
})

export const Seeded = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl))
  },
  async play({ canvas }) {
    await expect((await canvas.findAllByRole('listitem')).length).toBeGreaterThan(0)
  },
})

export const AllGood = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Nothing needs you' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'large'))
  },
  async play({ canvas }) {
    const tradingPartner = await canvas.findByRole(
      'region',
      { name: /^Waiting for a partner/ },
      { timeout: 10_000 },
    )

    await expect(within(tradingPartner).getAllByRole('listitem')).toHaveLength(10)
    await expect(
      within(tradingPartner).getByRole('button', { name: /^Show all \d+ tasks$/ }),
    ).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading tasks')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Tasks unavailable')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('region', { name: 'Von Ihnen zu beheben (2)' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('heading', { name: 'Rheinkauf eG hat den Empfang nicht bestätigt' }),
    ).toBeVisible()
  },
})

export const GermanAllGood = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Nichts braucht Sie' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('region', { name: 'Try again (1)' })).toBeVisible()
  },
})

export const DarkAllGood = meta.story({
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, 'empty'))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Nothing needs you' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('region', { name: 'Try again (1)' })
    await expectNoPageScroll(canvasElement)
  },
})
