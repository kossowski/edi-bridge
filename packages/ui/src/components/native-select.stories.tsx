import type { Meta, StoryObj } from '@storybook/react'

import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/NativeSelect',
  component: NativeSelect,
  args: { 'aria-label': 'Format' },
  render: (args) => (
    <NativeSelect {...args}>
      <NativeSelectOption value="edifact">EDIFACT</NativeSelectOption>
      <NativeSelectOption value="csv">CSV</NativeSelectOption>
    </NativeSelect>
  ),
} satisfies Meta<typeof NativeSelect>

export default meta

type Story = StoryObj<typeof meta>

export const Focused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('combobox', { name: 'Format' }), userEvent)
  },
}

export const FocusedDark: Story = { ...Focused, beforeEach: darkMode }
