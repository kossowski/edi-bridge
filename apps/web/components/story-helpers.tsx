import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import messagesDe from '@/messages/de.json'
import { type Invite, inviteValidityDays } from '@edi-bridge/contracts'
import { dayMs, seedWorkspaceSummaries, type WorkspaceSummaryRecord } from '@edi-bridge/mocks'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

// Menus, dialogs and sheets render in a portal outside the story's root.
export function page(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body)
}

// A dialog or sheet fades in. A busy CI runner can take longer than the default second.
export async function findOpenDialog(canvasElement: HTMLElement, name: string) {
  const wait = { timeout: 5000 }
  const dialog = await page(canvasElement).findByRole('dialog', { name }, wait)

  await waitFor(() => expect(dialog).toBeVisible(), wait)

  return dialog
}

// The menu fades in.
export async function findOpenMenu(canvasElement: HTMLElement) {
  const menu = await page(canvasElement).findByRole('menu')

  await waitFor(() => expect(menu).toBeVisible())

  return within(menu)
}

// A dialog takes the focus a frame or more after it shows; a key pressed before then misses it.
export async function waitForFocusInside(element: HTMLElement) {
  await waitFor(() => expect(element.contains(element.ownerDocument.activeElement)).toBe(true), {
    timeout: 5000,
  })
}

export async function waitForFocusOn(element: HTMLElement) {
  await waitFor(() => expect(element).toHaveFocus(), { timeout: 5000 })
}

export async function expectNoPageScroll(canvasElement: HTMLElement) {
  const page = canvasElement.ownerDocument.documentElement

  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
}

export function pendingSince(invite: Invite, days: number): Invite {
  const createdAt = Date.now() - days * dayMs

  return {
    ...invite,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + inviteValidityDays * dayMs).toISOString(),
  }
}

export function withWorkspace(id: string, changes: Partial<WorkspaceSummaryRecord>) {
  return seedWorkspaceSummaries.map((workspace) =>
    workspace.id === id ? { ...workspace, ...changes } : workspace,
  )
}

export const german = (Story: () => ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

// At 768px the app's sidebar takes 16rem of the width.
export const besideSidebar = (Story: () => ReactNode) => (
  <div className="ml-64">
    <Story />
  </div>
)

export const withSidebarProvider = (
  Story: () => ReactNode,
  { parameters }: { parameters: { sidebarOpen?: boolean } },
) => (
  <SidebarProvider defaultOpen={parameters.sidebarOpen ?? true}>
    <Story />
    <SidebarInset>
      <div className="p-4">
        <SidebarTrigger label="Toggle sidebar" />
      </div>
    </SidebarInset>
  </SidebarProvider>
)

export const tablet = {
  parameters: {
    viewport: {
      options: { tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } } },
    },
  },
  globals: { viewport: { value: 'tablet', isRotated: false } },
}

export const mobile = {
  parameters: {
    viewport: {
      options: { mobile: { name: 'Mobile', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'mobile', isRotated: false } },
}

export const laptop = {
  parameters: {
    viewport: {
      options: { laptop: { name: 'Laptop', styles: { width: '1024px', height: '768px' } } },
    },
  },
  globals: { viewport: { value: 'laptop', isRotated: false } },
}

export const desktop = {
  parameters: {
    viewport: {
      options: { desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } } },
    },
  },
  globals: { viewport: { value: 'desktop', isRotated: false } },
}
