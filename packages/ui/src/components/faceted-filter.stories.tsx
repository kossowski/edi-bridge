import { expect, fn } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import { FacetedFilter } from '@edi-bridge/ui/components/faceted-filter'

const meta = {
  title: 'UI/FacetedFilter',
  component: FacetedFilter,
  args: {
    label: 'Status',
    clearLabel: 'Clear',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' },
    ],
    selected: [],
    onSelectedChange: fn(),
  },
} satisfies Meta<typeof FacetedFilter>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithSelection: Story = {
  args: { selected: ['closed'] },
  async play({ canvas }) {
    await expect(canvas.getByRole('button', { name: /Status/ })).toHaveTextContent('1')
  },
}
