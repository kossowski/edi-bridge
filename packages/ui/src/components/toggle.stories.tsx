import type { Meta, StoryObj } from '@storybook/react'

import { Toggle } from '@edi-bridge/ui/components/toggle'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Toggle',
  component: Toggle,
  args: { children: 'Errors only' },
} satisfies Meta<typeof Toggle>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Errors only' }), userEvent)
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }

export const PressedFocused: Story = { ...Focused, args: { defaultPressed: true } }

export const PressedFocusedDark: Story = { ...PressedFocused, beforeEach: darkMode }

export const OutlineFocused: Story = { ...Focused, args: { variant: 'outline' } }

export const OutlineFocusedDark: Story = { ...OutlineFocused, beforeEach: darkMode }
