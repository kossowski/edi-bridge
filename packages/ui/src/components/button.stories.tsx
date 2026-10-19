import { expect, fn, waitFor } from 'storybook/test'

import type { Meta, StoryContext, StoryObj } from '@storybook/react'

import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Reprocess', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

type Keyboard = StoryContext['userEvent']

function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

// The canvas paints any CSS colour, oklch and alpha included, over the page background as sRGB.
function paintOverPage(color: string) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

  if (!context) throw new Error('The browser has no 2D canvas.')
  context.fillStyle = getComputedStyle(document.body).backgroundColor
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)

  return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
}

function relativeLuminance(rgb: number[]) {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const value = channel / 255

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastWithPage(color: string) {
  const [lighter = 0, darker = 0] = [
    relativeLuminance(paintOverPage(color)),
    relativeLuminance(paintOverPage('transparent')),
  ].sort((a, b) => b - a)

  return (lighter + 0.05) / (darker + 0.05)
}

// WCAG 2.2 asks a focus indicator for 3:1 against the colours next to it.
async function expectVisibleFocusRing(element: HTMLElement, keyboard: Keyboard) {
  await keyboard.tab()
  await expect(element).toHaveFocus()
  await waitFor(() => {
    const style = getComputedStyle(element)

    expect(style.outlineStyle).toBe('solid')
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
    expect(contrastWithPage(style.outlineColor)).toBeGreaterThanOrEqual(3)
  })
}

async function expectVisibleBorder(element: HTMLElement) {
  const style = getComputedStyle(element)

  await expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThanOrEqual(1)
  await expect(contrastWithPage(style.borderTopColor)).toBeGreaterThanOrEqual(1.2)
}

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
