import { z } from 'zod'

import { directionSchema } from './run'

import type { Endpoint } from './endpoint'

export const channelTypes = ['sftp', 'webhook', 'http'] as const

export const channelTypeSchema = z.enum(channelTypes)

export type ChannelType = z.infer<typeof channelTypeSchema>

export const channelSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  type: channelTypeSchema,
  direction: directionSchema,
  tradingPartnerId: z.uuid().nullable(),
})

export type ChannelSummary = z.infer<typeof channelSummarySchema>

export const channelsEndpoint: Endpoint<ChannelSummary[]> = {
  method: 'GET',
  path: '/channels',
  response: z.array(channelSummarySchema),
}
