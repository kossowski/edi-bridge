import { expect, userEvent, waitFor } from 'storybook/test'

import { LocaleSwitcher } from '@/components/locale-switcher'
import { findOpenMenu, german, page } from '@/components/story-helpers'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Shell/LocaleSwitcher',
  component: LocaleSwitcher,
  parameters: { a11y: { context: 'body' } },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-4 p-4">
        <Story />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" />
          Next control
        </label>
      </div>
    ),
  ],
})

export const ChoosingClosesTheMenu = meta.story({
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Language' }))
    const menu = await findOpenMenu(canvasElement)

    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Deutsch' }))
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Next control' }))
    await expect(canvas.getByRole('checkbox', { name: 'Next control' })).toBeChecked()
  },
})

export const ChoosingByKeyboard = meta.story({
  async play({ canvas, canvasElement }) {
    const trigger = await canvas.findByRole('button', { name: 'Language' })

    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await findOpenMenu(canvasElement)

    await waitFor(() => expect(menu.getByRole('menuitemradio', { name: 'English' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(page(canvasElement).queryByRole('menu')).toBeNull())
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Sprache' }))
    const menu = await findOpenMenu(canvasElement)

    await expect(menu.getByRole('menuitemradio', { name: 'Deutsch' })).toBeChecked()
  },
})
