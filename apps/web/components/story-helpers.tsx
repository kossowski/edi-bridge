import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'
import { expect } from 'storybook/test'

import messagesDe from '@/messages/de.json'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
}

export async function expectNoPageScroll(canvasElement: HTMLElement) {
  const page = canvasElement.ownerDocument.documentElement

  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth)
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
