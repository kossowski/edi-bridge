import { http, HttpResponse } from 'msw'

import { type ChannelSummary, channelSummarySchema, channelsEndpoint } from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { hasTraffic, seedTradingPartners } from './trading-partner'

const erpChannels: ReadonlyArray<Omit<ChannelSummary, 'id'>> = [
  { name: 'ERP webhook', type: 'webhook', direction: 'inbound', tradingPartnerId: null },
  { name: 'ERP HTTP delivery', type: 'http', direction: 'outbound', tradingPartnerId: null },
]

const tradingPartnerChannels = seedTradingPartners
  .filter(hasTraffic)
  .flatMap((tradingPartner): Array<Omit<ChannelSummary, 'id'>> => {
    const shortName = tradingPartner.name.split(' ')[0]

    return [
      {
        name: `${shortName} SFTP inbox`,
        type: 'sftp',
        direction: 'inbound',
        tradingPartnerId: tradingPartner.id,
      },
      {
        name: `${shortName} SFTP outbox`,
        type: 'sftp',
        direction: 'outbound',
        tradingPartnerId: tradingPartner.id,
      },
    ]
  })

export const seedChannels: ReadonlyArray<ChannelSummary> = [
  ...erpChannels,
  ...tradingPartnerChannels,
].map((channel, index) => channelSummarySchema.parse({ ...channel, id: seedId(3, index + 1) }))

export function channelsHandler(
  apiUrl: string,
  channels: ReadonlyArray<ChannelSummary> = seedChannels,
) {
  return http.get(`${apiUrl}${channelsEndpoint.path}`, () => HttpResponse.json(channels))
}
