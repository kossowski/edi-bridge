import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import { NewTradingPartnerScreen } from '@/components/trading-partners/trading-partner-form-screen'
import messagesDe from '@/messages/de.json'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Trading Partners/TradingPartnerFormScreen',
  component: NewTradingPartnerScreen,
  parameters: { layout: 'fullscreen' },
})

export const New = meta.story({
  async play({ canvas }) {
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'New trading partner' }),
    ).toBeInTheDocument()
    await expect(canvas.getByLabelText('GLN')).toHaveValue('')
    await expect(canvas.getByText(/starts in Test Mode/)).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  async play({ canvas }) {
    await expect(canvas.getByRole('button', { name: 'Trading Partner anlegen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(canvas.getByRole('button', { name: 'Create Trading Partner' })).toBeVisible()
  },
})
