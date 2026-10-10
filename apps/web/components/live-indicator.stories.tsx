import { NextIntlClientProvider } from 'next-intl'

import { LiveIndicator } from '@/components/live-indicator'
import messagesDe from '@/messages/de.json'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Overview/LiveIndicator',
  component: LiveIndicator,
})

export const Connecting = meta.story({ args: { status: 'connecting' } })

export const Connected = meta.story({ args: { status: 'connected' } })

export const Reconnecting = meta.story({ args: { status: 'reconnecting' } })

export const Offline = meta.story({ args: { status: 'offline' } })

export const German = meta.story({
  args: { status: 'reconnecting' },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
})

export const Dark = meta.story({
  args: { status: 'offline' },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
})
