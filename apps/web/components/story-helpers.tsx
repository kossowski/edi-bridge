import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode } from 'react'

import messagesDe from '@/messages/de.json'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

export function darkMode() {
  document.documentElement.classList.add('dark')

  return () => document.documentElement.classList.remove('dark')
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
