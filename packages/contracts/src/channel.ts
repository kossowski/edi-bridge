import { z } from 'zod'

import { directionSchema } from './run'

import type { Endpoint } from './endpoint'

export const channelTypes = ['sftp', 'webhook', 'http'] as const

export const channelTypeSchema = z.enum(channelTypes)

export type ChannelType = z.infer<typeof channelTypeSchema>

export const sftpAuthentications = ['password', 'privateKey'] as const

export const sftpAuthenticationSchema = z.enum(sftpAuthentications)

export type SftpAuthentication = z.infer<typeof sftpAuthenticationSchema>

export const pollingIntervalMinutes = { min: 1, max: 1440, default: 1 } as const

export const webhookRateLimitPerMinute = { min: 1, max: 6000, default: 60 } as const

export const sftpPort = { min: 1, max: 65_535, default: 22 } as const

export const webhookTokenSchema = z.string().regex(/^whk_[A-Za-z0-9]{32}$/)

export const webhookPath = '/webhooks/:id'

// Write-only: accepted in requests, never returned. Responses carry a maskedSecretSchema instead.
export const secretInputSchema = z.string().min(1).max(16_384)

export const maskedSecretSchema = z.strictObject({
  lastFour: z.string().length(4).nullable(),
})

export type MaskedSecret = z.infer<typeof maskedSecretSchema>

const channelIdentity = {
  name: z.string().trim().min(1).max(70),
  tradingPartnerId: z.uuid().nullable(),
}

const sftpConnection = {
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[^\s/:]+$/),
  port: z.number().int().min(sftpPort.min).max(sftpPort.max),
  username: z.string().trim().min(1).max(128),
  remotePath: z.string().trim().max(1024).regex(/^\//),
  authentication: sftpAuthenticationSchema,
}

const sftpPolling = {
  pollingIntervalMinutes: z
    .number()
    .int()
    .min(pollingIntervalMinutes.min)
    .max(pollingIntervalMinutes.max),
}

const webhookRateLimit = {
  rateLimitPerMinute: z
    .number()
    .int()
    .min(webhookRateLimitPerMinute.min)
    .max(webhookRateLimitPerMinute.max),
}

const httpDestination = {
  url: z.url({ protocol: /^https?$/ }),
}

const inboundSftp = { type: z.literal('sftp'), direction: z.literal('inbound') }

const outboundSftp = { type: z.literal('sftp'), direction: z.literal('outbound') }

const inboundWebhook = { type: z.literal('webhook'), direction: z.literal('inbound') }

const outboundHttp = { type: z.literal('http'), direction: z.literal('outbound') }

export const channelInputSchema = z.discriminatedUnion('type', [
  z.discriminatedUnion('direction', [
    z.object({
      ...inboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      ...sftpPolling,
      credential: secretInputSchema,
    }),
    z.object({
      ...outboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      credential: secretInputSchema,
    }),
  ]),
  z.object({ ...inboundWebhook, ...channelIdentity, ...webhookRateLimit }),
  z.object({
    ...outboundHttp,
    ...channelIdentity,
    ...httpDestination,
    authorization: secretInputSchema.nullable(),
  }),
])

export type ChannelInput = z.infer<typeof channelInputSchema>

// Omitting a secret keeps the stored one; for HTTP, null removes the Authorization header.
export const channelUpdateSchema = z.discriminatedUnion('type', [
  z.discriminatedUnion('direction', [
    z.object({
      ...inboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      ...sftpPolling,
      credential: secretInputSchema.optional(),
    }),
    z.object({
      ...outboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      credential: secretInputSchema.optional(),
    }),
  ]),
  z.object({ ...inboundWebhook, ...channelIdentity, ...webhookRateLimit }),
  z.object({
    ...outboundHttp,
    ...channelIdentity,
    ...httpDestination,
    authorization: secretInputSchema.nullable().optional(),
  }),
])

export type ChannelUpdate = z.infer<typeof channelUpdateSchema>

// Strict objects, so a response that leaks a plaintext secret fails to parse.
export const channelSchema = z.discriminatedUnion('type', [
  z.discriminatedUnion('direction', [
    z.strictObject({
      id: z.uuid(),
      ...inboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      ...sftpPolling,
      credential: maskedSecretSchema,
    }),
    z.strictObject({
      id: z.uuid(),
      ...outboundSftp,
      ...channelIdentity,
      ...sftpConnection,
      credential: maskedSecretSchema,
    }),
  ]),
  z.strictObject({
    id: z.uuid(),
    ...inboundWebhook,
    ...channelIdentity,
    ...webhookRateLimit,
    url: z.url(),
    token: maskedSecretSchema,
  }),
  z.strictObject({
    id: z.uuid(),
    ...outboundHttp,
    ...channelIdentity,
    ...httpDestination,
    authorization: maskedSecretSchema.nullable(),
  }),
])

export type Channel = z.infer<typeof channelSchema>

export const channelSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  type: channelTypeSchema,
  direction: directionSchema,
  tradingPartnerId: z.uuid().nullable(),
})

export type ChannelSummary = z.infer<typeof channelSummarySchema>

// The plaintext webhook token is returned exactly once, when the Channel is created or the
// token is regenerated: the sender needs it, and it cannot be read back afterwards.
export const createdChannelSchema = z.strictObject({
  channel: channelSchema,
  webhookToken: webhookTokenSchema.nullable(),
})

export type CreatedChannel = z.infer<typeof createdChannelSchema>

export const regeneratedWebhookTokenSchema = z.strictObject({
  channel: channelSchema,
  webhookToken: webhookTokenSchema,
})

export type RegeneratedWebhookToken = z.infer<typeof regeneratedWebhookTokenSchema>

export const channelsEndpoint: Endpoint<Channel[], undefined, undefined, '/channels'> = {
  method: 'GET',
  path: '/channels',
  response: z.array(channelSchema),
}

export const channelEndpoint: Endpoint<Channel, undefined, undefined, '/channels/:id'> = {
  method: 'GET',
  path: '/channels/:id',
  response: channelSchema,
}

export const createChannelEndpoint: Endpoint<CreatedChannel, undefined, ChannelInput, '/channels'> =
  {
    method: 'POST',
    path: '/channels',
    body: channelInputSchema,
    response: createdChannelSchema,
  }

export const updateChannelEndpoint: Endpoint<Channel, undefined, ChannelUpdate, '/channels/:id'> = {
  method: 'PUT',
  path: '/channels/:id',
  body: channelUpdateSchema,
  response: channelSchema,
}

export const regenerateWebhookTokenEndpoint: Endpoint<
  RegeneratedWebhookToken,
  undefined,
  undefined,
  '/channels/:id/webhook-token'
> = {
  method: 'POST',
  path: '/channels/:id/webhook-token',
  response: regeneratedWebhookTokenSchema,
}
