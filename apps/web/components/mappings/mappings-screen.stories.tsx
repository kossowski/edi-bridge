import { expect, userEvent, within } from 'storybook/test'

import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createHandlers, createMappingsWithTraffic, mappingHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Mappings/MappingsScreen',
  component: MappingsScreen,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/mappings' } } },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

async function lane(canvasElement: HTMLElement, name: string) {
  return within(await within(canvasElement).findByRole('region', { name }))
}

function card(link: HTMLElement) {
  // SAFETY: every card title link sits inside the card's list item.
  return within(link.closest('li') as HTMLElement)
}

async function badges(canvasElement: HTMLElement, name: string) {
  const region = await within(canvasElement).findByRole('region', { name })

  return Array.from(
    region.querySelectorAll('li [data-slot="badge"]'),
    (badge) => badge.textContent ?? '',
  )
}

const stateOrder = ['Documents failed', 'Draft not published', 'Never published', 'Running fine']

export const Default = meta.story({
  async play({ canvasElement }) {
    const comingIn = await lane(canvasElement, 'Coming in')
    const goingOut = await lane(canvasElement, 'Going out')

    await expect(comingIn.getByText('Trading partner')).toBeVisible()

    const shared = card(
      await goingOut.findByRole('link', { name: 'Dispatch advices to 2 partners' }),
    )

    await expect(shared.getByText('Documents failed')).toBeVisible()
    await expect(shared.getByText(/failed this week/)).toBeVisible()
    await expect(
      shared.getByText('Bodensee Handelshaus AG and Spreewald Frische GmbH'),
    ).toBeVisible()
    await expect(shared.getByText('Your ERP dispatch advice')).toBeVisible()
    await expect(shared.getByRole('link', { name: 'See what failed' })).toBeVisible()

    const fresh = card(goingOut.getByRole('link', { name: 'Invoices' }))

    await expect(fresh.getAllByText('Never published')).toHaveLength(2)
    await expect(fresh.getByText('Nothing is translated yet')).toBeVisible()
    await expect(fresh.getByText('No trading partner yet')).toBeVisible()
    await expect(fresh.getByRole('link', { name: 'Draft with AI' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/mappings\/[\w-]+\?ai-draft=start$/),
    )

    const draft = card(
      comingIn.getByRole('link', { name: 'Receipt confirmations from Spreewald Frische GmbH' }),
    )

    await expect(draft.getByText('Draft not published')).toBeVisible()
    await expect(draft.getByText('Changes not published')).toBeVisible()
    await expect(draft.getByRole('link', { name: 'Review and publish' })).toBeVisible()
    await expect(draft.getByText(/^Version 3 live since/)).toBeVisible()

    const live = card(
      comingIn.getByRole('link', { name: 'Purchase orders from Bodensee Handelshaus AG' }),
    )

    await expect(live.getByText('Running fine')).toBeVisible()
    await expect(live.getByText(/translated this week|No documents this week/)).toBeVisible()
    await expect(live.getByRole('link', { name: 'Open' })).toBeVisible()
  },
})

export const NeedsAttention = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 16 })))
  },
  async play({ canvas, canvasElement }) {
    const needsYou = await canvas.findByRole('button', { name: /Needs you/ })

    const shown = [
      ...(await badges(canvasElement, 'Coming in')),
      ...(await badges(canvasElement, 'Going out')),
    ]

    await expect(new Set(shown)).toEqual(new Set(stateOrder))

    for (const name of ['Coming in', 'Going out']) {
      const ranks = (await badges(canvasElement, name)).map((badge) => stateOrder.indexOf(badge))

      await expect(ranks).toEqual(ranks.toSorted((left: number, right: number) => left - right))
    }

    await userEvent.click(needsYou)

    await expect(needsYou).toHaveAttribute('aria-pressed', 'true')

    for (const name of ['Coming in', 'Going out']) {
      for (const badge of await badges(canvasElement, name)) {
        await expect(['Documents failed', 'Draft not published']).toContain(badge)
      }
    }
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: 'loading' }))
  },
  async play({ canvas }) {
    await expect(canvas.getByRole('status')).toHaveTextContent('Loading Mappings')
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: 'error' }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mappings unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, createMappingsWithTraffic({ count: 300 })))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('button', { name: /All\s*300/ })).toBeVisible()

    const comingIn = await lane(canvasElement, 'Coming in')

    await expect(comingIn.getAllByRole('listitem')).toHaveLength(20)

    await userEvent.click(comingIn.getByRole('button', { name: /^Show all \d+$/ }))

    await expect(comingIn.getAllByRole('listitem').length).toBeGreaterThan(20)
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...mappingHandlers(apiUrl, { mappings: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findAllByText('Nothing here right now')).toHaveLength(2)
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvasElement }) {
    const comingIn = await lane(canvasElement, 'Eingehend')
    const goingOut = await lane(canvasElement, 'Ausgehend')

    await expect(comingIn.getByText('Handelspartner')).toBeVisible()
    await expect(
      await goingOut.findByRole('link', { name: 'Lieferavise an 2 Partner' }),
    ).toBeVisible()
    await expect(
      comingIn.getByRole('link', { name: 'Bestellungen von Bodensee Handelshaus AG' }),
    ).toBeVisible()
    await expect(goingOut.getByRole('link', { name: 'Mit KI entwerfen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Dispatch advices to 2 partners' }),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Dispatch advices to 2 partners' }),
    ).toBeVisible()
  },
})
