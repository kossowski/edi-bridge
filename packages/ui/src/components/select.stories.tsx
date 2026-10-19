import type { Meta, StoryObj } from '@storybook/react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'

import { darkMode, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/Select',
  component: SelectTrigger,
  render: () => (
    <Select defaultValue="edifact">
      <SelectTrigger aria-label="Format">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="edifact">EDIFACT</SelectItem>
        <SelectItem value="csv">CSV</SelectItem>
      </SelectContent>
    </Select>
  ),
} satisfies Meta<typeof SelectTrigger>

export default meta

type Story = StoryObj<typeof meta>

export const TriggerFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('combobox', { name: 'Format' }), userEvent)
  },
}

export const TriggerFocusedDark: Story = { ...TriggerFocused, beforeEach: darkMode }
