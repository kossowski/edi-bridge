import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'

import '@edi-bridge/ui/globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { cn } from '@edi-bridge/ui/lib/utils'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('antialiased', GeistSans.variable, GeistMono.variable, 'font-sans')}>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
