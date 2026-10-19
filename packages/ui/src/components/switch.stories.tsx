import type { Meta, StoryObj } from '@storybook/react'

import { Switch } from '@edi-bridge/ui/components/switch'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Switch',
  component: Switch,
  args: { 'aria-label': 'Active' },
} satisfies Meta<typeof Switch>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('switch', { name: 'Active' }), userEvent)
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }

export const CheckedFocused: Story = { ...Focused, args: { defaultChecked: true } }

export const CheckedFocusedDark: Story = { ...CheckedFocused, beforeEach: darkMode }
