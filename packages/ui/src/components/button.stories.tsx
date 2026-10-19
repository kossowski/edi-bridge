import { expect, fn } from 'storybook/test'

import type { Meta, StoryObj } from '@storybook/react'

import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

import { darkMode, expectVisibleBorder, expectVisibleFocusRing } from '../testing/checks'

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Reprocess', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

const focusRing = {
  async play({ canvas, userEvent }) {
    await expectVisibleFocusRing(canvas.getByRole('button', { name: 'Reprocess' }), userEvent)
  },
} satisfies Story

const outlineLink = {
  render: () => (
    <a href="#edit" className={buttonVariants({ variant: 'outline' })}>
      Edit
    </a>
  ),
  async play({ canvas, userEvent }) {
    const link = canvas.getByRole('link', { name: 'Edit' })

    await expectVisibleBorder(link)
    await expectVisibleFocusRing(link, userEvent)
  },
} satisfies Story

export const Default: Story = {
  async play({ args, canvas, userEvent }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Reprocess' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const DefaultFocused: Story = focusRing

export const DefaultFocusedDark: Story = { ...focusRing, beforeEach: darkMode }

export const Outline: Story = {
  args: { variant: 'outline' },
  async play({ canvas, userEvent }) {
    const button = canvas.getByRole('button', { name: 'Reprocess' })

    await expectVisibleBorder(button)
    await expectVisibleFocusRing(button, userEvent)
  },
}

export const OutlineDark: Story = { ...Outline, beforeEach: darkMode }

export const OutlineLink: Story = outlineLink

export const OutlineLinkDark: Story = { ...outlineLink, beforeEach: darkMode }

export const Secondary: Story = { ...focusRing, args: { variant: 'secondary' } }

export const SecondaryDark: Story = { ...Secondary, beforeEach: darkMode }

export const Ghost: Story = { ...focusRing, args: { variant: 'ghost' } }

export const GhostDark: Story = { ...Ghost, beforeEach: darkMode }

export const Destructive: Story = { ...focusRing, args: { variant: 'destructive' } }

export const DestructiveDark: Story = { ...Destructive, beforeEach: darkMode }

export const Link: Story = { ...focusRing, args: { variant: 'link' } }

export const LinkDark: Story = { ...Link, beforeEach: darkMode }

export const Disabled: Story = {
  args: { disabled: true },
}

export const FocusableWhenDisabled: Story = {
  args: { disabled: true, focusableWhenDisabled: true },
  async play({ canvas }) {
    const button = canvas.getByRole('button', { name: 'Reprocess' })

    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).toHaveStyle({ opacity: '0.5' })
  },
}
