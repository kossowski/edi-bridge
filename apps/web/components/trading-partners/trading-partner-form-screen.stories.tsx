import { NextIntlClientProvider } from 'next-intl'
import { expect } from 'storybook/test'

import {
  EditTradingPartnerScreen,
  NewTradingPartnerScreen,
} from '@/components/trading-partners/trading-partner-form-screen'
import messagesDe from '@/messages/de.json'
import { seedTradingPartners } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const tradingPartner = seedTradingPartners[1]!

const meta = preview.meta({
  title: 'Trading Partners/TradingPartnerFormScreen',
  component: NewTradingPartnerScreen,
  parameters: { layout: 'fullscreen' },
})

export const New = meta.story({
  async play({ canvas }) {
    await expect(canvas.getByRole('heading', { name: 'New Trading Partner' })).toBeVisible()
    await expect(canvas.getByLabelText('GLN')).toHaveValue('')
    await expect(canvas.getByText(/starts in Test Mode/)).toBeVisible()
  },
})

export const Edit = meta.story({
  render: () => <EditTradingPartnerScreen id={tradingPartner.id} />,
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('GLN')).toHaveValue(tradingPartner.gln)
    await expect(canvas.getByLabelText('Acknowledgement time limit (hours)')).toHaveValue(
      tradingPartner.acknowledgementTimeLimitHours,
    )
  },
})

export const EditNotFound = meta.story({
  render: () => <EditTradingPartnerScreen id="10000000-0000-4000-8000-0000000000ff" />,
  async play({ canvas }) {
    await expect(await canvas.findByText('Trading Partner not found')).toBeVisible()
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
  render: () => <EditTradingPartnerScreen id={tradingPartner.id} />,
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Save changes' })).toBeVisible()
  },
})
