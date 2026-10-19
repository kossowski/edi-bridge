import type { Meta, StoryObj } from '@storybook/react'

import { Input } from '@edi-bridge/ui/components/input'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { 'aria-label': 'Trading partner' },
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(
      canvas.getByRole('textbox', { name: 'Trading partner' }),
      userEvent,
    )
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }
