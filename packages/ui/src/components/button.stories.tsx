import { expect, fn } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '@edi-bridge/ui/components/button'

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Reprocess', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  async play({ args, canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Reprocess' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const Outline: Story = {
  args: { variant: 'outline' },
}

export const Destructive: Story = {
  args: { variant: 'destructive' },
}

export const Disabled: Story = {
  args: { disabled: true },
}
