import type { Meta, StoryObj } from '@storybook/react'

import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  args: { 'aria-label': 'Direction', defaultValue: 'inbound' },
  render: (args) => (
    <RadioGroup {...args}>
      <RadioGroupItem value="inbound" aria-label="Inbound" />
      <RadioGroupItem value="outbound" aria-label="Outbound" />
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>

export default meta

type Story = StoryObj<typeof meta>

export const ItemFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('radio', { name: 'Inbound' }), userEvent)
  },
}

export const ItemFocusedDark: Story = { ...ItemFocused, beforeEach: darkMode }
