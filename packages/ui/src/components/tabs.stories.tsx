import type { Meta, StoryObj } from '@storybook/react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Tabs',
  component: TabsList,
  args: { variant: 'default' },
  render: (args) => (
    <Tabs defaultValue="segments">
      <TabsList {...args}>
        <TabsTrigger value="segments">Segments</TabsTrigger>
        <TabsTrigger value="raw">Raw</TabsTrigger>
      </TabsList>
      <TabsContent value="segments">UNH+1</TabsContent>
      <TabsContent value="raw">UNA:+.? &apos;</TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof TabsList>

export default meta

type Story = StoryObj<typeof meta>

export const TriggerFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('tab', { name: 'Segments' }), userEvent)
  },
}

export const TriggerFocusedDark: Story = { ...TriggerFocused, beforeEach: darkMode }

export const LineTriggerFocused: Story = { ...TriggerFocused, args: { variant: 'line' } }

export const LineTriggerFocusedDark: Story = { ...LineTriggerFocused, beforeEach: darkMode }
