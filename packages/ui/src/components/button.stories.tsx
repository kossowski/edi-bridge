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

// The shadcn destructive colours reach a contrast of 4:1, below the WCAG AA 4.5:1; fix in the theme tokens.
export const Destructive: Story = {
  args: { variant: 'destructive' },
  parameters: { a11y: { test: 'todo' } },
}

export const Disabled: Story = {
  args: { disabled: true },
}
