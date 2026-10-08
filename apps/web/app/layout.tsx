import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import { cookies } from 'next/headers'

import type { Metadata } from 'next'

import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { QueryProvider } from '@/components/query-provider'
import { ThemeProvider } from '@/components/theme-provider'

import '@edi-bridge/ui/globals.css'
import {
  SIDEBAR_COOKIE_NAME,
  SidebarInset,
  SidebarProvider,
} from '@edi-bridge/ui/components/sidebar'
import { TooltipProvider } from '@edi-bridge/ui/components/tooltip'
import { cn } from '@edi-bridge/ui/lib/utils'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Shell')

  return { title: t('appName') }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const t = await getTranslations('Shell')
  const cookieStore = await cookies()
  const sidebarOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== 'false'

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn('antialiased', GeistSans.variable, GeistMono.variable, 'font-sans')}>
      <body>
        <a
          href="#main-content"
          className="bg-background text-foreground ring-ring sr-only z-50 rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2">
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <ThemeProvider>
            <QueryProvider>
              <TooltipProvider>
                <SidebarProvider defaultOpen={sidebarOpen}>
                  <AppSidebar />
                  <SidebarInset className="min-w-0">
                    <AppHeader />
                    <div
                      id="main-content"
                      tabIndex={-1}
                      className="flex flex-1 flex-col outline-none">
                      {children}
                    </div>
                  </SidebarInset>
                </SidebarProvider>
              </TooltipProvider>
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
