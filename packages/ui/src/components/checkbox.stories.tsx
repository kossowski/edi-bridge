import type { Meta, StoryObj } from '@storybook/react'

import { Checkbox } from '@edi-bridge/ui/components/checkbox'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  args: { 'aria-label': 'Required' },
} satisfies Meta<typeof Checkbox>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('checkbox', { name: 'Required' }), userEvent)
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }

export const CheckedFocused: Story = { ...Focused, args: { defaultChecked: true } }

export const CheckedFocusedDark: Story = { ...CheckedFocused, beforeEach: darkMode }
