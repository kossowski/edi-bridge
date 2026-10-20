import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { NextIntlClientProvider } from 'next-intl'
// A private Next module, but the one Storybook's own router provider fills.
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { type ReactNode, useLayoutEffect, useMemo, useState } from 'react'
import { expect } from 'storybook/test'

import messagesDe from '@/messages/de.json'
import { type Invite, inviteValidityDays } from '@edi-bridge/contracts'
import { dayMs, seedWorkspaceSummaries, type WorkspaceSummaryRecord } from '@edi-bridge/mocks'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export {
  darkMode,
  findOpenDialog,
  findOpenMenu,
  page,
  waitForFocusInside,
  waitForFocusOn,
  waitForMenuClosed,
} from '@edi-bridge/ui/testing/checks'

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

type StoryNavigation = { pathname: string; query?: Record<string, string> }

function MemoryHistory({ start, children }: { start: StoryNavigation; children: ReactNode }) {
  const [history, setHistory] = useState(() => ({
    entries: [`${start.pathname}?${new URLSearchParams(start.query)}`],
    index: 0,
  }))

  useLayoutEffect(() => {
    const router = getRouter()

    router.push.mockImplementation((href: string) =>
      setHistory(({ entries, index }) => ({
        entries: [...entries.slice(0, index + 1), href],
        index: index + 1,
      })),
    )
    router.replace.mockImplementation((href: string) =>
      setHistory(({ entries, index }) => ({ entries: entries.with(index, href), index })),
    )
    router.back.mockImplementation(() =>
      setHistory(({ entries, index }) => ({ entries, index: Math.max(0, index - 1) })),
    )
    router.forward.mockImplementation(() =>
      setHistory(({ entries, index }) => ({
        entries,
        index: Math.min(entries.length - 1, index + 1),
      })),
    )
  }, [])

  const href = history.entries[history.index] ?? ''
  const [pathname = '', search = ''] = href.split('?')
  const searchParams = useMemo(() => new URLSearchParams(search), [search])

  return (
    <PathnameContext.Provider value={pathname}>
      <SearchParamsContext.Provider value={searchParams}>{children}</SearchParamsContext.Provider>
    </PathnameContext.Provider>
  )
}

export const withMemoryHistory = (
  Story: () => ReactNode,
  { parameters }: { parameters: { nextjs?: { navigation?: StoryNavigation } } },
) => (
  <MemoryHistory start={parameters.nextjs?.navigation ?? { pathname: '/' }}>
    <Story />
  </MemoryHistory>
)

export const goBack = () => getRouter().back()

export const goForward = () => getRouter().forward()

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
