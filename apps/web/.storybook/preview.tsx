import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import addonMsw from 'msw-storybook-addon'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode, useState } from 'react'

import { startMockWorker } from '@/lib/api/mock-worker'
import messages from '@/messages/en.json'

import '@edi-bridge/ui/globals.css'

function StoryQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export default definePreview({
  addons: [
    addonA11y(),
    // Relative so the worker also registers under the GitHub Pages sub-path.
    addonMsw(() =>
      startMockWorker({ quiet: true, serviceWorker: { url: './mockServiceWorker.js' } }),
    ),
  ],
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Berlin">
        <StoryQueryProvider>
          <Story />
        </StoryQueryProvider>
      </NextIntlClientProvider>
    ),
  ],
  parameters: {
    a11y: { test: 'error' },
    nextjs: { appDirectory: true },
  },
})
