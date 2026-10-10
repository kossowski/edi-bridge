import { expect, fn } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import { NativeCheckbox } from '@edi-bridge/ui/components/native-checkbox'

const meta = {
  title: 'UI/NativeCheckbox',
  component: NativeCheckbox,
  args: { 'aria-label': 'Required', onChange: fn() },
} satisfies Meta<typeof NativeCheckbox>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  async play({ args, canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Required' }))
    await expect(args.onChange).toHaveBeenCalledOnce()
    await expect(canvas.getByRole('checkbox', { name: 'Required' })).toBeChecked()
  },
}

export const Checked: Story = {
  args: { defaultChecked: true },
}

export const Disabled: Story = {
  args: { disabled: true },
}
