import { expect, within } from 'storybook/test'

import { FirstStepsScreen } from '@/components/first-steps/first-steps-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { firstStepsHandler, seedTradingPartners } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'FirstSteps/FirstStepsScreen',
  component: FirstStepsScreen,
  parameters: { layout: 'fullscreen' },
})

async function stepsOf(canvasElement: HTMLElement) {
  const list = await within(canvasElement).findByRole('list', { name: 'Steps' })

  return within(list).getAllByRole('listitem')
}

export const Fresh = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'fresh'))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('0 of 6 steps done')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'How EDI Bridge works' })).toBeVisible()

    const [gln, ...rest] = await stepsOf(canvasElement)

    await expect(gln).toHaveAttribute('aria-current', 'step')
    await expect(within(gln!).getByText('Next')).toBeVisible()
    await expect(within(gln!).getByRole('link', { name: 'Open company settings' })).toHaveAttribute(
      'href',
      '/settings?tab=company',
    )

    for (const step of rest) {
      await expect(step).not.toHaveAttribute('aria-current')
      await expect(within(step).getByText('Open')).toBeVisible()
    }

    await expect(canvas.getByRole('link', { name: 'Connect your ERP' })).toHaveAttribute(
      'href',
      '/channels/new',
    )
    await expect(canvas.getByRole('link', { name: 'Send a test' })).toHaveAttribute(
      'href',
      '/trading-partners/new',
    )
    await expect(canvas.queryByText(/Prototype/)).toBeNull()
  },
})

export const PartlyDone = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'partlyDone'))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('3 of 6 steps done')).toBeVisible()

    const steps = await stepsOf(canvasElement)

    const awaitingTest = seedTradingPartners.find(
      ({ testMode, onboarding }) => testMode && onboarding.testInterchangeSentAt === null,
    )

    for (const step of steps.slice(0, 3)) {
      await expect(within(step).getByText('Done')).toBeVisible()
      await expect(
        within(step).queryByRole('link', {
          name: /^(Open company settings|Connect your ERP|Add a trading partner)$/,
        }),
      ).toBeNull()
    }

    await expect(steps[3]).toHaveAttribute('aria-current', 'step')
    await expect(within(steps[3]!).getByRole('link', { name: 'Create a mapping' })).toHaveAttribute(
      'href',
      '/mappings',
    )
    await expect(canvas.getByRole('link', { name: 'Send a test' })).toHaveAttribute(
      'href',
      `/trading-partners/${awaitingTest?.id}`,
    )
  },
})

export const AllDone = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText('6 of 6 steps done')).toBeVisible()

    for (const step of await stepsOf(canvasElement)) {
      await expect(within(step).getByText('Done')).toBeVisible()
      await expect(step).not.toHaveAttribute('aria-current')
    }

    await expect(canvas.queryByRole('link', { name: 'Go live' })).toBeNull()
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    handlers: [firstStepsHandler(apiUrl, 'partlyDone')],
    async play({ canvas }) {
      await expect(await canvas.findByText('3 of 6 steps done')).toBeVisible()
      await expect(canvas.getByText('An admin of your workspace does this step.')).toBeVisible()
      await expect(canvas.queryByRole('link', { name: 'Create a mapping' })).toBeNull()
    },
  }),
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'loading'))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading first steps')).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { name: 'How EDI Bridge works' })).toBeVisible()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'error'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('First steps unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'partlyDone'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('3 von 6 Schritten erledigt')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'So funktioniert EDI Bridge' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Mapping anlegen' })).toHaveAttribute(
      'href',
      '/mappings',
    )
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'partlyDone'))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('3 of 6 steps done')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(firstStepsHandler(apiUrl, 'fresh'))
  },
  async play({ canvas, canvasElement }) {
    await canvas.findByText('0 of 6 steps done')
    await expectNoPageScroll(canvasElement)
  },
})
