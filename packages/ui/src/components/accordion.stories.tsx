import type { Meta, StoryObj } from '@storybook/react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@edi-bridge/ui/components/accordion'

import { darkMode, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Accordion',
  component: Accordion,
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="envelope">
        <AccordionTrigger>Envelope</AccordionTrigger>
        <AccordionContent>UNB+UNOC:3</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
} satisfies Meta<typeof Accordion>

export default meta

type Story = StoryObj<typeof meta>

export const TriggerFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Envelope' }), userEvent)
  },
}

export const TriggerFocusedDark: Story = { ...TriggerFocused, beforeEach: darkMode }
