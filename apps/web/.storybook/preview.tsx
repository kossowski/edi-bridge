import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import addonMsw from 'msw-storybook-addon'
import { setupWorker } from 'msw/browser'
import { NextIntlClientProvider } from 'next-intl'

import { apiUrl } from '@/lib/api/config'
import messages from '@/messages/en.json'
import { createHandlers } from '@edi-bridge/mocks'

import '@edi-bridge/ui/globals.css'

export default definePreview({
  addons: [
    addonA11y(),
    addonMsw(async () => {
      const worker = setupWorker(...createHandlers(apiUrl))

      // Relative so the worker also registers under the GitHub Pages sub-path.
      await worker.start({
        onUnhandledFrame: 'bypass',
        quiet: true,
        serviceWorker: { url: './mockServiceWorker.js' },
      })

      return worker
    }),
  ],
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Berlin">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Story />
        </QueryClientProvider>
      </NextIntlClientProvider>
    ),
  ],
  parameters: {
    a11y: { test: 'error' },
    nextjs: { appDirectory: true },
  },
})
