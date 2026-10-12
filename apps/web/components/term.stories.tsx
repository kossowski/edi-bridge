import { expect, userEvent, waitFor } from 'storybook/test'

import { darkMode, german } from '@/components/story-helpers'
import { Term } from '@/components/term'

import preview from '../.storybook/preview'

function card() {
  return document.querySelector('[data-slot="hover-card-content"]')
}

async function hoverUntilOpen(trigger: HTMLElement) {
  await waitFor(
    async () => {
      if (!trigger.hasAttribute('data-popup-open')) {
        await userEvent.unhover(trigger)
        await userEvent.hover(trigger)
      }

      await expect(trigger).toHaveAttribute('data-popup-open')
    },
    { timeout: 5000, interval: 1000 },
  )
}

const meta = preview.meta({
  title: 'Shared/Term',
  component: Term,
  render: (args) => (
    <p className="bg-background text-foreground p-4 text-sm">
      <Term {...args} />
    </p>
  ),
})

export const Light = meta.story({
  args: { glossaryKey: 'lookupTable' },
  async play({ canvas }) {
    const term = canvas.getByRole('link', { name: 'Code translation' })

    await expect(term).toHaveAttribute('href', '/help#lookup-table')
    await expect(term).toHaveAccessibleDescription(/Technical term: Lookup Table$/)
  },
})

export const KeyboardFocus = meta.story({
  args: { glossaryKey: 'lookupTable' },
  async play({ canvas }) {
    await userEvent.tab()

    await expect(canvas.getByRole('link', { name: 'Code translation' })).toHaveFocus()
    await waitFor(() => expect(card()).toBeVisible(), { timeout: 2000 })
    await expect(card()).toHaveTextContent('Code translation')
    await expect(card()).toHaveTextContent('Technical term: Lookup Table')
    await expect(card()?.querySelector('[lang="en"]')).toHaveTextContent('Lookup Table')

    await userEvent.tab()

    await waitFor(() => expect(card()).toBeNull(), { timeout: 2000 })
  },
})

export const Hover = meta.story({
  args: { glossaryKey: 'lookupTable' },
  async play({ canvas }) {
    await hoverUntilOpen(canvas.getByRole('link', { name: 'Code translation' }))

    await waitFor(() => expect(card()).toBeVisible(), { timeout: 2000 })
    await expect(card()).toHaveTextContent('Technical term: Lookup Table')
  },
})

export const MessageType = meta.story({
  args: { glossaryKey: 'ORDERS' },
  async play({ canvas }) {
    const term = canvas.getByRole('link', { name: 'Purchase order' })

    await expect(term).toHaveAttribute('href', '/help#orders')
    await expect(term).toHaveAccessibleDescription(/Technical term: Message Type ORDERS$/)
  },
})

export const CustomText = meta.story({
  args: { glossaryKey: 'reprocess', children: 'reprocessed' },
  async play({ canvas }) {
    await expect(canvas.getByRole('link', { name: 'reprocessed' })).toHaveAttribute(
      'href',
      '/help#reprocess',
    )
  },
})

export const German = meta.story({
  args: { glossaryKey: 'lookupTable' },
  decorators: [german],
  async play({ canvas }) {
    const term = canvas.getByRole('link', { name: 'Code-Übersetzung' })

    await expect(term).toHaveAccessibleDescription(/Fachbegriff: Lookup Table$/)

    await userEvent.tab()

    await waitFor(() => expect(card()).toBeVisible(), { timeout: 2000 })
    await expect(card()).toHaveTextContent('Fachbegriff: Lookup Table')
  },
})

export const Dark = meta.story({
  args: { glossaryKey: 'lookupTable' },
  beforeEach: darkMode,
  async play() {
    await userEvent.tab()

    await waitFor(() => expect(card()).toBeVisible(), { timeout: 2000 })
  },
})

export const DarkGerman = meta.story({
  args: { glossaryKey: 'lookupTable' },
  decorators: [german],
  beforeEach: darkMode,
  async play() {
    await userEvent.tab()

    await waitFor(() => expect(card()).toBeVisible(), { timeout: 2000 })
    await expect(card()).toHaveTextContent('Fachbegriff: Lookup Table')
  },
})
