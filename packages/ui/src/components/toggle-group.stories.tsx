import type { Meta, StoryObj } from '@storybook/react'

import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'

import { darkMode, expectFocusRingInside, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  args: { spacing: 0, variant: 'outline' },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="inbound">Inbound</ToggleGroupItem>
      <ToggleGroupItem value="outbound">Outbound</ToggleGroupItem>
      <ToggleGroupItem value="internal">Internal</ToggleGroupItem>
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

export const MiddleItemFocused: Story = {
  async play({ canvas, userEvent }) {
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    await expectFocusRingInside(canvas.getByRole('button', { name: 'Outbound' }), [
      canvas.getByRole('button', { name: 'Inbound' }),
      canvas.getByRole('button', { name: 'Internal' }),
    ])
  },
}

export const MiddleItemFocusedDark: Story = { ...MiddleItemFocused, beforeEach: darkMode }
