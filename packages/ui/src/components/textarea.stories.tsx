import type { Meta, StoryObj } from '@storybook/react'

import { Textarea } from '@edi-bridge/ui/components/textarea'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
  args: { 'aria-label': 'Note' },
} satisfies Meta<typeof Textarea>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('textbox', { name: 'Note' }), userEvent)
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }
