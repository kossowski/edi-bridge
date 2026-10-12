import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import type { StoryContext } from '@storybook/nextjs-vite'

import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'
import {
  chooseMapping,
  continueTo,
  findMappingGroup,
  toMappings,
  wizardPartner,
} from '@/components/trading-partners/partner-wizard-story-helpers'
import { apiUrl } from '@/lib/api/config'
import { channelKinds, channelsEndpoint } from '@edi-bridge/contracts'
import { channelHandlers, createChannel, seedChannels } from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

type Canvas = StoryContext['canvas']

const ordersMapping = 'Hansemarkt: ORDERS to ERP JSON'

const invoicesMapping = 'Hansemarkt: ERP JSON to INVOIC'

async function toReview(canvas: Canvas) {
  await chooseMapping(canvas, 'ORDERS', ordersMapping)
  await chooseMapping(canvas, 'INVOIC', invoicesMapping)
  await continueTo(canvas, 'Review and create')
}

function section(canvas: Canvas, name: string) {
  return within(canvas.getByRole('region', { name }))
}

async function findSection(canvas: Canvas, name: string) {
  return within(await canvas.findByRole('region', { name }))
}

const httpOutbound = channelKinds.find(
  (kind) => kind.type === 'http' && kind.direction === 'outbound',
)

const meta = preview.meta({
  title: 'Trading Partners/PartnerWizard/Review',
  component: PartnerWizard,
  parameters: { layout: 'fullscreen' },
})

export const AllRoutes = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await toReview(canvas)

    const partner = await findSection(canvas, 'Partner')
    await expect(partner.getByText(wizardPartner)).toBeVisible()
    await expect(partner.getByText('GLN 0234567890129')).toBeVisible()
    await expect(partner.getByText('Testing')).toBeVisible()

    const connections = section(canvas, 'Connections')
    await expect(connections.getByText(`${wizardPartner} webhook`)).toBeVisible()
    await expect(connections.getByText(`${wizardPartner} HTTP delivery`)).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Mappings' })).not.toBeInTheDocument()

    const routes = section(canvas, 'Document routes')
    await expect(routes.getByText(`Purchase orders from ${wizardPartner}`)).toBeVisible()
    await expect(
      routes.getByText(
        new RegExp(
          `^From ${wizardPartner} webhook to ERP HTTP delivery, with the mapping ${ordersMapping}`,
        ),
      ),
    ).toBeVisible()
    await expect(routes.getByText(`Invoices to ${wizardPartner}`)).toBeVisible()
    await expect(
      routes.getByText(new RegExp(`^From ERP webhook to ${wizardPartner} HTTP delivery`)),
    ).toBeVisible()
    await expect(canvas.getByText('Created for testing')).toBeVisible()
  },
})

export const Postponed = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { ways: { inbound: 'ask' } })
    await toReview(canvas)

    const connections = await findSection(canvas, 'Connections')
    await expect(connections.getAllByRole('listitem')).toHaveLength(1)
    await expect(connections.getByText(`${wizardPartner} HTTP delivery`)).toBeVisible()

    const routes = section(canvas, 'Document routes')
    await expect(
      routes.getByText('Document route for purchase orders: set up later on the partner page'),
    ).toBeVisible()
    await expect(
      routes.getByText(`${wizardPartner} still sends you the connection details.`),
    ).toBeVisible()
    await expect(routes.getByText(`Invoices to ${wizardPartner}`)).toBeVisible()
  },
})

export const AllPostponed = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { ways: { inbound: 'ask', outbound: 'ask' } })
    await toReview(canvas)

    const connections = await findSection(canvas, 'Connections')
    await expect(
      connections.getByText(
        'No connection yet. You add them on the partner page once the partner sends the details.',
      ),
    ).toBeVisible()
  },
})

export const AiDrafts = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'DESADV'])

    for (const document of ['ORDERS', 'DESADV'] as const) {
      const group = await findMappingGroup(canvas, document)
      await userEvent.click(group.getByRole('radio', { name: /Let AI draft one/ }))
    }

    await continueTo(canvas, 'Review and create')

    const mappings = await findSection(canvas, 'Mappings')
    await expect(mappings.getByText('New mapping for purchase orders')).toBeVisible()
    await expect(mappings.getByText('New mapping for dispatch advices')).toBeVisible()

    const routes = section(canvas, 'Document routes')
    await expect(
      routes.getAllByText('The route follows once the AI draft is published.'),
    ).toHaveLength(2)
  },
})

export const MappingLater = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['INVOIC'])
    const invoices = await findMappingGroup(canvas, 'INVOIC')
    await userEvent.click(invoices.getByRole('radio', { name: /^Later/ }))
    await continueTo(canvas, 'Review and create')

    const routes = await findSection(canvas, 'Document routes')
    await expect(
      routes.getByText('Document route for invoices: set up later on the partner page'),
    ).toBeVisible()
    await expect(routes.getByText('You choose the mapping there.')).toBeVisible()
  },
})

export const SeveralOwnConnections = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...channelHandlers(apiUrl, {
        channels: httpOutbound ? [...seedChannels, createChannel(httpOutbound)] : seedChannels,
      }),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await toReview(canvas)

    const routes = await findSection(canvas, 'Document routes')
    await expect(
      routes.getByText(
        'Several of your own connections fit purchase orders. You choose one there.',
      ),
    ).toBeVisible()
    await expect(routes.getByText(`Invoices to ${wizardPartner}`)).toBeVisible()
  },
})

export const NoOwnConnection = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...channelHandlers(apiUrl, {
        channels: seedChannels.filter((channel) => channel.tradingPartnerId !== null),
      }),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await toReview(canvas)

    const routes = await findSection(canvas, 'Document routes')
    await expect(
      routes.getByText('None of your own connections fits purchase orders yet.'),
    ).toBeVisible()
    await expect(routes.getByText('None of your own connections fits invoices yet.')).toBeVisible()
  },
})

export const GlnLater = meta.story({
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { glnLater: true })
    await toReview(canvas)

    const partner = await findSection(canvas, 'Partner')
    await expect(partner.getByText('GLN not added yet')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await toReview(canvas)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Loading your connections and mappings…',
    )
    await expect(canvas.queryByRole('region')).not.toBeInTheDocument()
  },
})

export const LoadFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'])
    await toReview(canvas)

    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('Your connections and mappings could not be loaded')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await userEvent.type(canvas.getByLabelText('Firmenname'), wizardPartner)
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Ich trage sie später ein' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Rechnungen senden/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Wir fragen den Partner/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))
    await userEvent.click(await canvas.findByRole('radio', { name: /Von der KI entwerfen lassen/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Weiter' }))

    const routes = await findSection(canvas, 'Belegwege')
    await expect(
      routes.getByText('Belegweg für Rechnungen: später auf der Partnerseite einrichten'),
    ).toBeVisible()
    await expect(
      section(canvas, 'Mappings').getByText('Neues Mapping für Rechnungen'),
    ).toBeVisible()
    await expect(canvas.getByText('Im Testbetrieb angelegt')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Partner im Testbetrieb anlegen' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach: darkMode,
  async play({ canvas }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { ways: { inbound: 'ask' } })
    await toReview(canvas)
    await expect(await canvas.findByText('Created for testing')).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  async play({ canvas, canvasElement }) {
    await toMappings(canvas, ['ORDERS', 'INVOIC'], { glnLater: true })
    await toReview(canvas)
    await expect(await canvas.findByRole('region', { name: 'Document routes' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
