import { expect, waitFor } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'

import { darkMode, expectFocusRingInside, expectVisibleFocusRing } from '../stories/checks'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  args: { spacing: 0, variant: 'outline' },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="inbound">Inbound</ToggleGroupItem>
      <ToggleGroupItem value="outbound">Outbound</ToggleGroupItem>
      <ToggleGroupItem value="internal">Internal</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>

export default meta

type Story = StoryObj<typeof meta>

export const ItemFocused: Story = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Inbound' }), userEvent)
  },
}

export const ItemFocusedDark: Story = { ...ItemFocused, beforeEach: darkMode }

export const MiddleItemFocused: Story = {
  async play({ canvas, userEvent }) {
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    await expectFocusRingInside(canvas.getByRole('button', { name: 'Outbound' }), [
      canvas.getByRole('button', { name: 'Inbound' }),
      canvas.getByRole('button', { name: 'Internal' }),
    ])
  },
}

export const MiddleItemFocusedDark: Story = { ...MiddleItemFocused, beforeEach: darkMode }

// The ring box of a focused item, read from its outline, has to sit inside the scroller's visible box.
async function expectRingInView(element: HTMLElement, scroller: HTMLElement) {
  await expect(element).toHaveFocus()
  await waitFor(async () => {
    const style = getComputedStyle(element)

    const reach = Math.max(
      Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth),
      0,
    )

    const ring = element.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    const visibleLeft = box.left + scroller.clientLeft
    const visibleRight = visibleLeft + scroller.clientWidth

    await expect(ring.left - reach).toBeGreaterThanOrEqual(visibleLeft)
    await expect(ring.right + reach).toBeLessThanOrEqual(visibleRight)
  })
}

export const ItemFocusedInScroller: Story = {
  render: (args) => (
    <div className="w-40 overflow-x-auto p-1" data-testid="scroller">
      <ToggleGroup {...args}>
        <ToggleGroupItem value="inbound" className="w-24">
          Inbound
        </ToggleGroupItem>
        <ToggleGroupItem value="outbound" className="w-24">
          Outbound
        </ToggleGroupItem>
        <ToggleGroupItem value="internal" className="w-24">
          Internal
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
  async play({ canvas, userEvent }) {
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    await expectRingInView(
      canvas.getByRole('button', { name: 'Outbound' }),
      canvas.getByTestId('scroller'),
    )
  },
}

export const ItemFocusedInScrollerDark: Story = { ...ItemFocusedInScroller, beforeEach: darkMode }

export const SpacedItemFocusedInScroller: Story = { ...ItemFocusedInScroller, args: { spacing: 2 } }
