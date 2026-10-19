import type { Meta, StoryObj } from '@storybook/react'

import { Badge } from '@edi-bridge/ui/components/badge'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: {
    children: 'Failed',
    render: ({ children, ...props }) => (
      <a href="#runs" {...props}>
        {children}
      </a>
    ),
  },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const LinkFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('link', { name: 'Failed' }), userEvent)
  },
}

export const LinkFocusedDark: Story = { ...LinkFocused, beforeEach: darkMode }

export const OutlineLinkFocused: Story = { ...LinkFocused, args: { variant: 'outline' } }

export const OutlineLinkFocusedDark: Story = { ...OutlineLinkFocused, beforeEach: darkMode }

export const DestructiveLinkFocused: Story = { ...LinkFocused, args: { variant: 'destructive' } }

export const DestructiveLinkFocusedDark: Story = { ...DestructiveLinkFocused, beforeEach: darkMode }
