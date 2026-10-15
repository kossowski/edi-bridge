import { expect, screen, userEvent, within } from 'storybook/test'

import { CodeTranslationsScreen } from '@/components/code-translations/code-translations-screen'
import { viewerStory } from '@/components/session/session-story-helpers'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createLookupTables,
  lookupTableHandlers,
  type MappingDraftRecord,
  seedLookupTables,
  seedMappingDrafts,
} from '@edi-bridge/mocks'

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

const mappingLink = /^\/mappings\/[\w-]+$/

// SAFETY: the seed Hansemarkt DESADV mapping reads Units of measure.
const dispatchAdviceDraft = seedMappingDrafts.find(
  ({ name }) => name === 'Hansemarkt: ERP JSON to DESADV',
) as MappingDraftRecord

const extraDispatchAdviceMappings = Array.from({ length: 4 }, (_, index) => ({
  ...dispatchAdviceDraft,
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  name: `Extra dispatch advices ${index + 1}`,
}))

const [extraBlocking] = createLookupTables({ count: 1, blockingCodeCount: 2, seed: 5 })

const busyTables = seedLookupTables.map((table) =>
  table.name === 'Units of measure'
    ? { ...table, blockingCodes: extraBlocking?.blockingCodes ?? [] }
    : table,
)

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

    await expect(units.getByText('KRT missing')).toBeVisible()
    await expect(units.getByText('4 values').parentElement).toHaveTextContent(
      /^Units of measure · 4 values$/,
    )
    const usedFor = within(units.getByRole('list', { name: 'Used for' }))
    const uses = usedFor.getAllByRole('link')
    const [firstUse] = uses

    await expect(uses.map(({ textContent }) => textContent)).toEqual([
      'Dispatch advices to Elbtal Warenhaus KG',
      'Invoices to Elbtal Warenhaus KG',
      'Dispatch advices to Hansemarkt GmbH',
    ])
    await expect(usedFor.getByText('and 1 more')).toBeVisible()
    await expect(firstUse).toHaveAttribute('href', expect.stringMatching(mappingLink))
    await expect(units.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/code-translations\/[\w-]+$/),
    )
    await expect(units.getByRole('link', { name: 'Add KRT' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/code-translations\/[\w-]+\?add=KRT$/),
    )

    const hansemarkt = within(canvas.getByRole('region', { name: 'Only for Hansemarkt GmbH (2)' }))
    const storeNumbers = card(hansemarkt.getByRole('link', { name: 'Hansemarkt store numbers' }))

    await expect(storeNumbers.getByText('Not used in a mapping yet')).toBeVisible()
    await expect(storeNumbers.queryByRole('link', { name: /^Add / })).toBeNull()
    await expect(
      storeNumbers.getByRole('button', { name: 'Actions for Hansemarkt store numbers' }),
    ).toBeVisible()
    await expect(canvas.getByText('1 list blocks documents', { exact: false })).toBeVisible()
  },
})

export const NewList = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'New list' })).toHaveAttribute(
      'href',
      '/code-translations/new',
    )
  },
})

export const ManyUsesAndCodes = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...lookupTableHandlers(apiUrl, {
        lookupTables: busyTables,
        mappings: [...seedMappingDrafts, ...extraDispatchAdviceMappings],
      }),
    )
  },
  async play({ canvas }) {
    const units = card(await canvas.findByRole('link', { name: 'Units of measure' }))
    const usedFor = within(units.getByRole('list', { name: 'Used for' }))

    await expect(usedFor.getAllByRole('link')).toHaveLength(3)
    await expect(usedFor.getByText(/^and \d+ more$/)).toBeVisible()
    await expect(units.getByText(/^[\w-]+, [\w-]+, and 1 more missing$/)).toBeVisible()
    await expect(units.getByRole('link', { name: /^Add [\w-]+$/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/\?add=[\w-]+$/),
    )
  },
})

async function openActions(
  name: string,
  labels = { actions: `Actions for ${name}`, delete: 'Delete' },
) {
  const title = await screen.findByRole('link', { name })

  await userEvent.click(card(title).getByRole('button', { name: labels.actions }))

  return screen.findByRole('menuitem', { name: labels.delete })
}

export const DeleteInUse = meta.story({
  async play() {
    const remove = await openActions('Units of measure')

    await expect(remove).toHaveAttribute('aria-disabled', 'true')
    await expect(remove).toHaveAccessibleDescription(
      'Used for Dispatch advices to Elbtal Warenhaus KG, Invoices to Elbtal Warenhaus KG, Dispatch advices to Hansemarkt GmbH, and 1 more.',
    )
    remove.focus()
    await userEvent.keyboard('{Enter}')
    await expect(screen.queryByRole('dialog')).toBeNull()
  },
})

export const DeleteUnused = meta.story({
  async play({ canvas }) {
    const remove = await openActions('Hansemarkt store numbers')

    await expect(remove).not.toHaveAttribute('aria-disabled')
    await expect(remove).not.toHaveAccessibleDescription()
    await userEvent.click(remove)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete list' }))
    await expect(await canvas.findByText('Hansemarkt store numbers deleted.')).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Hansemarkt store numbers' })).toBeNull()
  },
})

export const GermanDeleteInUse = meta.story({
  decorators: [german],
  async play() {
    const remove = await openActions('Units of measure', {
      actions: 'Aktionen für Units of measure',
      delete: 'Löschen',
    })

    await expect(remove).toHaveAccessibleDescription(
      'Verwendet für Lieferavise an Elbtal Warenhaus KG, Rechnungen an Elbtal Warenhaus KG, Lieferavise an Hansemarkt GmbH und 1 weitere.',
    )
  },
})

export const KeyboardFocus = meta.story({
  async play({ canvas }) {
    const name = await canvas.findByRole('link', { name: 'Units of measure' })
    const usedFor = within(card(name).getByRole('list', { name: 'Used for' }))
    // SAFETY: the seed Mappings use Units of measure, so the list holds at least one link.
    const firstUse = usedFor.getAllByRole('link')[0] as HTMLElement

    name.focus()
    await userEvent.tab()
    await expect(firstUse).toHaveFocus()
    await expect(getComputedStyle(firstUse).boxShadow).not.toBe('none')
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
    const newLinks = canvas.getAllByRole('link', { name: 'New list' })

    await expect(newLinks).toHaveLength(2)

    for (const link of newLinks) {
      await expect(link).toHaveAttribute('href', '/code-translations/new')
    }
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
    const showAll = everyPartner.getByRole('button', { name: /^Show all \d+ lists$/ })

    await expect(showAll).toBeVisible()
    await expect(showAll).not.toHaveAttribute('aria-expanded')
    await expect(canvas.getAllByText(/^[\w-]+ and [\w-]+ missing$/).length).toBeGreaterThan(0)
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    const everyPartner = within(
      await canvas.findByRole('region', { name: 'An jeden Partner gesendet (3)' }),
    )

    const units = card(everyPartner.getByRole('link', { name: 'Units of measure' }))

    await expect(units.getByText('KRT fehlt')).toBeVisible()
    await expect(units.getByRole('link', { name: 'KRT hinzufügen' })).toBeVisible()
    const usedFor = within(units.getByRole('list', { name: 'Verwendet für' }))

    await expect(usedFor.getAllByRole('listitem').map(({ textContent }) => textContent)).toEqual([
      'Lieferavise an Elbtal Warenhaus KG',
      'Rechnungen an Elbtal Warenhaus KG',
      'Lieferavise an Hansemarkt GmbH',
      'und 1 weitere',
    ])
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
      await expect(canvas.queryByRole('link', { name: 'New list' })).toBeNull()
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
      await expect(canvas.queryByRole('link', { name: 'New list' })).toBeNull()
    },
  }),
})
