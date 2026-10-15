import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { QueryProvider } from '@/components/query-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@edi-bridge/ui/components/sonner'
import { TooltipProvider } from '@edi-bridge/ui/components/tooltip'
import { cn } from '@edi-bridge/ui/lib/utils'

import '@edi-bridge/ui/globals.css'

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
              <TooltipProvider>{children}</TooltipProvider>
            </QueryProvider>
            <Toaster containerAriaLabel={t('toasts')} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
