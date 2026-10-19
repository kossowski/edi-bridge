import { expect, waitFor } from 'storybook/test'

import type { StoryContext } from '@storybook/react'

type UserEvent = StoryContext['userEvent']

// A light border only has to set the control apart from the page; WCAG 1.4.11 lets the label carry the 3:1.
const minBorderContrast = 1.2

export function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

function backgroundBehind(element: HTMLElement) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const color = getComputedStyle(parent).backgroundColor

    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
  }

  return getComputedStyle(document.body).backgroundColor
}

// The canvas paints any CSS colour, oklch and alpha included, over the background as sRGB.
function paintOver(background: string, color: string) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })

  if (!context) throw new Error('The browser has no 2D canvas.')
  context.fillStyle = background
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

function contrastBehind(element: HTMLElement, color: string) {
  const background = backgroundBehind(element)

  const [lighter = 0, darker = 0] = [
    relativeLuminance(paintOver(background, color)),
    relativeLuminance(paintOver(background, 'transparent')),
  ].sort((a, b) => b - a)

  return (lighter + 0.05) / (darker + 0.05)
}

// WCAG 2.2 asks a focus indicator for 3:1 against the colours next to it.
export async function expectVisibleFocusRing(
  element: HTMLElement,
  userEvent: UserEvent,
  ring: HTMLElement = element,
) {
  await userEvent.tab()
  await expect(element).toHaveFocus()
  await waitFor(async () => {
    const style = getComputedStyle(ring)

    await expect(style.outlineStyle).toBe('solid')
    await expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
    await expect(contrastBehind(ring, style.outlineColor)).toBeGreaterThanOrEqual(3)
  })
}

// The base classes transition every property, so a colour read right after a theme switch can be mid-way.
export async function expectVisibleBorder(element: HTMLElement) {
  await waitFor(async () => {
    const style = getComputedStyle(element)

    await expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThanOrEqual(1)
    await expect(contrastBehind(element, style.borderTopColor)).toBeGreaterThanOrEqual(
      minBorderContrast,
    )
  })
}
