import addonA11y from '@storybook/addon-a11y'
import { definePreview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import addonMsw from 'msw-storybook-addon'
import { NextIntlClientProvider } from 'next-intl'
import { type ReactNode, useState } from 'react'
import { configure } from 'storybook/test'

import { apiUrl } from '@/lib/api/config'
import { startMockWorker } from '@/lib/api/mock-worker'
import messages from '@/messages/en.json'
import { TooltipProvider } from '@edi-bridge/ui/components/tooltip'

import '@edi-bridge/ui/globals.css'

function StoryQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// A busy machine can answer from the mock API after the default second of `findBy…` and `waitFor`.
configure({ asyncUtilTimeout: 5000 })

export default definePreview({
  addons: [
    addonA11y(),
    // Relative so the worker also registers under the GitHub Pages sub-path.
    addonMsw(() =>
      startMockWorker({
        liveEvents: 'quiet',
        quiet: true,
        serviceWorker: { url: `./mock-api-worker.js?api=${encodeURIComponent(apiUrl)}` },
      }),
    ),
  ],
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Berlin">
        <StoryQueryProvider>
          <TooltipProvider>
            <Story />
          </TooltipProvider>
        </StoryQueryProvider>
      </NextIntlClientProvider>
    ),
  ],
  parameters: {
    a11y: {
      test: 'error',
      // Every passing element otherwise ends up in each story's report, about 2 MB on the mapping
      // canvas, which the test run then copies out of the browser. Passes keep one example each.
      options: { resultTypes: ['violations', 'incomplete'] },
    },
    nextjs: { appDirectory: true },
  },
})
