import { expect, fn } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@edi-bridge/ui/components/input-group'

type Args = { onClear: () => void }

const meta = {
  title: 'UI/InputGroup',
  args: { onClear: fn() },
} satisfies Meta<Args>

export default meta

type Story = StoryObj<Args>

export const AddonFocusesInput: Story = {
  render: ({ onClear }) => (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>GLN</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Partner" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={onClear}>Clear</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
  async play({ args, canvas, userEvent }) {
    const input = canvas.getByRole('textbox', { name: 'Partner' })

    await userEvent.click(canvas.getByText('GLN'))
    await expect(input).toHaveFocus()

    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }))
    await expect(args.onClear).toHaveBeenCalledOnce()
    await expect(input).not.toHaveFocus()
  },
}

export const AddonFocusesTextarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea aria-label="Note" />
      <InputGroupAddon align="block-end">
        <InputGroupText>Shown to the partner</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
  async play({ canvas, userEvent }) {
    await userEvent.click(canvas.getByText('Shown to the partner'))
    await expect(canvas.getByRole('textbox', { name: 'Note' })).toHaveFocus()
  },
}
