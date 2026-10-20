'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import * as React from 'react'

// Only the server HTML runs the script; a client render (the 404 page) would warn about it.
const themeScriptProps = {
  type: typeof window === 'undefined' ? 'text/javascript' : 'application/json',
}

function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
      scriptProps={themeScriptProps}
      {...props}>
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
