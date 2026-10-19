import { expect, waitFor, within } from 'storybook/test'

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
  await waitFor(() => expectSolidRing(ring))
}

async function expectSolidRing(ring: HTMLElement) {
  const style = getComputedStyle(ring)

  await expect(style.outlineStyle).toBe('solid')
  await expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2)
  await expect(contrastBehind(ring, style.outlineColor)).toBeGreaterThanOrEqual(3)
}

function outlineReach(element: HTMLElement) {
  const style = getComputedStyle(element)

  return Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth)
}

function overlaps(a: DOMRect, b: DOMRect) {
  // Half a pixel absorbs subpixel layout between items that only touch.
  const slack = 0.5

  return (
    a.left < b.right - slack &&
    b.left < a.right - slack &&
    a.top < b.bottom - slack &&
    b.top < a.bottom - slack
  )
}

// A focused item in a segmented group sits above its neighbours, so a ring outside its box paints over theirs.
export async function expectFocusRingInside(element: HTMLElement, neighbours: HTMLElement[]) {
  await expect(element).toHaveFocus()
  await waitFor(async () => {
    await expectSolidRing(element)

    const reach = Math.max(outlineReach(element), 0)
    const box = element.getBoundingClientRect()

    const ring = new DOMRect(
      box.x - reach,
      box.y - reach,
      box.width + 2 * reach,
      box.height + 2 * reach,
    )

    await expect(reach).toBeLessThanOrEqual(2)

    for (const neighbour of neighbours) {
      await expect(overlaps(ring, neighbour.getBoundingClientRect())).toBe(false)
    }
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

// Menus, dialogs and sheets render in a portal outside the story's root.
export function page(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

// A busy CI runner can take longer than the default second to finish a transition or move focus.
const transitionWait = { timeout: 5000 }

// A dialog or sheet fades in.
export async function findOpenDialog(canvasElement: HTMLElement, name: string) {
  const dialog = await page(canvasElement).findByRole('dialog', { name }, transitionWait)

  await waitFor(() => expect(dialog).toBeVisible(), transitionWait)

  return dialog
}

// The menu fades in.
export async function findOpenMenu(canvasElement: HTMLElement) {
  const menu = await page(canvasElement).findByRole('menu')

  await waitFor(() => expect(menu).toBeVisible())

  return within(menu)
}

// The menu, and any submenu open in it, fades out before it leaves the page.
export async function waitForMenuClosed(canvasElement: HTMLElement) {
  await waitFor(
    () => expect(page(canvasElement).queryAllByRole('menu')).toHaveLength(0),
    transitionWait,
  )
}

// A dialog takes the focus a frame or more after it shows; a key pressed before then misses it.
export async function waitForFocusInside(element: HTMLElement) {
  await waitFor(
    () => expect(element.contains(element.ownerDocument.activeElement)).toBe(true),
    transitionWait,
  )
}

export async function waitForFocusOn(element: HTMLElement) {
  await waitFor(() => expect(element).toHaveFocus(), transitionWait)
}

const maxFocusStops = 30

// Each press must leave the focus inside, and enough presses bring it back to where it started.
async function expectFocusCycles(dialog: HTMLElement, press: () => Promise<void>) {
  await waitForFocusInside(dialog)
  const start = dialog.ownerDocument.activeElement

  for (let stop = 1; stop <= maxFocusStops; stop++) {
    await press()
    await waitForFocusInside(dialog)

    if (dialog.ownerDocument.activeElement === start) return
  }

  throw new Error(`The focus did not come back within ${maxFocusStops} stops.`)
}

export async function expectFocusTrapped(dialog: HTMLElement, userEvent: UserEvent) {
  await expectFocusCycles(dialog, () => userEvent.tab())
  await expectFocusCycles(dialog, () => userEvent.tab({ shift: true }))
}
