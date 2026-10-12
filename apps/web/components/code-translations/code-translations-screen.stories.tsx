import { expect, screen, userEvent, within } from 'storybook/test'

import { CodeTranslationsScreen } from '@/components/code-translations/code-translations-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { createLookupTables, lookupTableHandlers } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Code Translations/CodeTranslationsScreen',
  component: CodeTranslationsScreen,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/code-translations' } } },
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl))
  },
})

function card(link: HTMLElement) {
  // SAFETY: every card title link sits inside the card's list item.
  return within(link.closest('li') as HTMLElement)
}

const largeVolume = [
  ...createLookupTables({ count: 380 }),
  ...createLookupTables({ count: 20, blockingCodeCount: 2, seed: 7 }),
]

export const Default = meta.story({
  async play({ canvas }) {
    const everyPartner = within(
      await canvas.findByRole('region', { name: 'Sent to every partner (3)' }),
    )

    const units = card(everyPartner.getByRole('link', { name: 'Units of measure' }))

    await expect(units.getByText('1 code blocks documents')).toBeVisible()
    await expect(units.getByText(/^\d+ values$/).parentElement).toHaveTextContent(
      /^Units of measure · \d+ values$/,
    )
    await expect(units.getByRole('list', { name: 'Used for' })).toHaveTextContent(
      /^Purchase orders from /,
    )
    await expect(units.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/code-translations\/[\w-]+$/),
    )

    const hansemarkt = within(canvas.getByRole('region', { name: 'Only for Hansemarkt GmbH (2)' }))
    const storeNumbers = card(hansemarkt.getByRole('link', { name: 'Hansemarkt store numbers' }))

    await expect(storeNumbers.getByText('Not used in a mapping yet')).toBeVisible()
    await expect(
      storeNumbers.getByRole('button', { name: 'Actions for Hansemarkt store numbers' }),
    ).toBeVisible()
    await expect(canvas.getByText('1 list blocks documents', { exact: false })).toBeVisible()
  },
})

export const NewList = meta.story({
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'New list' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'New Lookup Table' }))

    await expect(await dialog.findByRole('textbox', { name: 'Name' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'No code translations yet' }),
    ).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'New list' })).toHaveLength(2)
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: 'loading' }))
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading code translations')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: 'error' }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Code translations unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: largeVolume }))
  },
  async play({ canvas }) {
    const everyPartner = within(
      await canvas.findByRole(
        'region',
        { name: /^Sent to every partner \(\d+\)$/ },
        { timeout: 10_000 },
      ),
    )

    await expect(canvas.getByText('400 lists')).toBeVisible()
    await expect(everyPartner.getAllByRole('listitem')).toHaveLength(12)
    await expect(everyPartner.getByRole('button', { name: /^Show all \d+ lists$/ })).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    const everyPartner = within(
      await canvas.findByRole('region', { name: 'An jeden Partner gesendet (3)' }),
    )

    const units = card(everyPartner.getByRole('link', { name: 'Units of measure' }))

    await expect(units.getByText('1 Code blockiert Belege')).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Nur für Hansemarkt GmbH (2)' })).toBeVisible()
  },
})

export const GermanEmpty = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'Noch keine Code-Übersetzungen' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('region', { name: 'Sent to every partner (3)' }),
    ).toBeVisible()
  },
})

export const DarkEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { name: 'No code translations yet' }),
    ).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await canvas.findByRole('region', { name: 'Sent to every partner (3)' })
    await expectNoPageScroll(canvasElement)
  },
})

export const Viewer = meta.story({
  ...viewerStory({
    async play({ canvas }) {
      await expect(await canvas.findByRole('link', { name: 'Units of measure' })).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'New list' })).toBeNull()
      await expect(canvas.queryByRole('button', { name: /^Actions for / })).toBeNull()
    },
  }),
})

export const ViewerEmpty = meta.story({
  ...viewerStory({
    handlers: [...lookupTableHandlers(apiUrl, { lookupTables: [] })],
    async play({ canvas }) {
      await expect(
        await canvas.findByText(/They appear here once an Admin creates one\./),
      ).toBeVisible()
      await expect(canvas.queryByRole('button', { name: 'New list' })).toBeNull()
    },
  }),
})
