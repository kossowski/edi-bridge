import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, within } from 'storybook/test'

import { MappingsScreen } from '@/components/mappings/mappings-screen'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { mappingsEndpoint } from '@edi-bridge/contracts'
import { createHandlers, createMappingDrafts } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const meta = preview.meta({
  title: 'Mappings/MappingsScreen',
  component: MappingsScreen,
  parameters: { layout: 'fullscreen' },
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl))
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    const inbound = within(
      (await canvas.findByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' })).closest('tr')!,
    )

    await expect(inbound.getByText('Inbound')).toBeVisible()
    await expect(inbound.getByText('ERP purchase order')).toBeVisible()
    await expect(inbound.getByText('Version 3')).toBeVisible()

    const outbound = within(
      canvas.getByRole('link', { name: 'Hansemarkt: ERP JSON to DESADV' }).closest('tr')!,
    )

    await expect(outbound.getByText('Outbound')).toBeVisible()
    await expect(canvas.getByText('Never published')).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Mappings yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(canvas.getByText('Loading Mappings')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${mappingsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Mappings unavailable')).toBeVisible()
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...createHandlers(apiUrl, { mappingDrafts: createMappingDrafts({ count: 300 }) }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('300 Mappings')).toBeVisible()
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
    await expect(
      await canvas.findByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
    await expect(canvas.getAllByText('Eingehend')[0]).toBeVisible()
    await expect(canvas.getByText('Nie veröffentlicht')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('link', { name: 'Hansemarkt: ORDERS to ERP JSON' }),
    ).toBeVisible()
  },
})
