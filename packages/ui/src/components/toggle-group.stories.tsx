import type { Meta, StoryObj } from '@storybook/react'

import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  args: { spacing: 0, variant: 'outline' },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="inbound">Inbound</ToggleGroupItem>
      <ToggleGroupItem value="outbound">Outbound</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>

export default meta

type Story = StoryObj<typeof meta>

export const ItemFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Inbound' }), userEvent)
  },
}

export const ItemFocusedDark: Story = { ...ItemFocused, beforeEach: darkMode }
