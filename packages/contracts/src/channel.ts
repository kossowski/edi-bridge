import { z } from 'zod'

import { type Direction, directionSchema, notRoutedMessagesSchema } from './message-type'

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

// How a sender presents the webhook token: `Authorization: Bearer whk_…`.
export const webhookTokenHeader = 'Authorization'

export function webhookAuthorization(token: string) {
  return `Bearer ${token}`
}

export const webhookSubmissionSchema = z.strictObject({
  documentId: z.uuid(),
  runs: z.array(z.strictObject({ id: z.uuid() })).min(1),
  notRouted: notRoutedMessagesSchema,
})

export type WebhookSubmission = z.infer<typeof webhookSubmissionSchema>

export const receiveWebhookEndpoint: Endpoint<
  WebhookSubmission,
  undefined,
  undefined,
  typeof webhookPath
> = {
  method: 'POST',
  path: webhookPath,
  response: webhookSubmissionSchema,
}

// Write-only: accepted in requests, never returned. Responses carry a maskedSecretSchema instead.
export const secretInputSchema = z.string().min(1).max(16_384)

export const maskedSecretSchema = z.strictObject({
  lastFour: z.string().length(4).nullable(),
})

export type MaskedSecret = z.infer<typeof maskedSecretSchema>

export const maxChannelNameLength = 70

// OpenSSH's `SHA256:<base64>` form: 32 bytes are 43 characters without padding, the last one
// carrying only four bits.
export const hostKeyFingerprintSchema = z
  .string()
  .trim()
  .regex(/^SHA256:[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/)

export type HostKeyFingerprint = z.infer<typeof hostKeyFingerprintSchema>

const channelIdentity = {
  name: z.string().trim().min(1).max(maxChannelNameLength),
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

const pollingIntervalSchema = z
  .number()
  .int()
  .min(pollingIntervalMinutes.min)
  .max(pollingIntervalMinutes.max)

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

const inboundSftp = { type: 'sftp', direction: 'inbound' } as const

const outboundSftp = { type: 'sftp', direction: 'outbound' } as const

const inboundWebhook = { type: 'webhook', direction: 'inbound' } as const

const outboundHttp = { type: 'http', direction: 'outbound' } as const

export const channelKinds = [
  inboundSftp,
  outboundSftp,
  inboundWebhook,
  outboundHttp,
] as const satisfies ReadonlyArray<{ type: ChannelType; direction: Direction }>

export type ChannelKind = (typeof channelKinds)[number]

function literals<Type extends ChannelType, Way extends Direction>({
  type,
  direction,
}: {
  type: Type
  direction: Way
}) {
  return { type: z.literal(type), direction: z.literal(direction) }
}

// Requests, updates and responses differ only in these parts, so all three share one shape.
function channelUnion<
  Config extends z.core.$ZodObjectConfig,
  Common extends Record<string, z.ZodType>,
  Credential extends z.ZodType,
  PollingInterval extends z.ZodType,
  Webhook extends Record<string, z.ZodType>,
  Authorization extends z.ZodType,
  HostKeyFingerprint extends z.ZodType,
>(
  object: <Fields extends Record<string, z.ZodType>>(
    fields: Fields,
  ) => z.ZodObject<z.core.util.Writeable<Fields>, Config>,
  parts: {
    common: Common
    credential: Credential
    pollingInterval: PollingInterval
    webhook: Webhook
    authorization: Authorization
    hostKeyFingerprint: HostKeyFingerprint
  },
) {
  const { common, credential, pollingInterval, webhook, authorization, hostKeyFingerprint } = parts

  return z.discriminatedUnion('type', [
    z.discriminatedUnion('direction', [
      object({
        ...common,
        ...literals(inboundSftp),
        ...channelIdentity,
        ...sftpConnection,
        pollingIntervalMinutes: pollingInterval,
        credential,
        hostKeyFingerprint,
      }),
      object({
        ...common,
        ...literals(outboundSftp),
        ...channelIdentity,
        ...sftpConnection,
        credential,
        hostKeyFingerprint,
      }),
    ]),
    object({
      ...common,
      ...literals(inboundWebhook),
      ...channelIdentity,
      ...webhookRateLimit,
      ...webhook,
    }),
    object({
      ...common,
      ...literals(outboundHttp),
      ...channelIdentity,
      ...httpDestination,
      authorization,
    }),
  ])
}

export const channelInputSchema = channelUnion(z.object, {
  common: {},
  credential: secretInputSchema,
  pollingInterval: pollingIntervalSchema.default(pollingIntervalMinutes.default),
  webhook: {},
  authorization: secretInputSchema.nullable(),
  hostKeyFingerprint: hostKeyFingerprintSchema.nullable().optional(),
})

export type ChannelInput = z.infer<typeof channelInputSchema>

// Omitting a secret or the host key fingerprint keeps the stored one; null removes the HTTP
// Authorization header or the fingerprint.
export const channelUpdateSchema = channelUnion(z.object, {
  common: {},
  credential: secretInputSchema.optional(),
  pollingInterval: pollingIntervalSchema,
  webhook: {},
  authorization: secretInputSchema.nullable().optional(),
  hostKeyFingerprint: hostKeyFingerprintSchema.nullable().optional(),
})

export type ChannelUpdate = z.infer<typeof channelUpdateSchema>

// Strict objects, so a response that leaks a plaintext secret fails to parse.
export const channelSchema = channelUnion(z.strictObject, {
  common: { id: z.uuid() },
  credential: maskedSecretSchema,
  pollingInterval: pollingIntervalSchema,
  webhook: { url: z.url(), token: maskedSecretSchema },
  authorization: maskedSecretSchema.nullable(),
  hostKeyFingerprint: hostKeyFingerprintSchema.nullable().optional(),
})

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

export const channelsEndpoint: Endpoint<Channel[]> = {
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

export const channelTestFailureReasons = [
  'hostKeyMismatch',
  'loginRejected',
  'hostUnreachable',
  'timedOut',
  'remotePathMissing',
  'permissionDenied',
  'unexpectedResponse',
] as const

export const channelTestFailureReasonSchema = z.enum(channelTestFailureReasons)

export type ChannelTestFailureReason = z.infer<typeof channelTestFailureReasonSchema>

// The API refuses to test a seeded Channel before reaching it, so no reach fails with this reason.
export const channelTestResultReasonSchema = z.enum([...channelTestFailureReasons, 'seededChannel'])

export type ChannelTestResultReason = z.infer<typeof channelTestResultReasonSchema>

export const hostKeyStates = ['matches', 'mismatch', 'unchecked'] as const

export const hostKeyStateSchema = z.enum(hostKeyStates)

export type HostKeyState = z.infer<typeof hostKeyStateSchema>

// The fingerprint the server presented, and how it compares to the one the Admin confirmed.
export const testedHostKeySchema = z.object({
  fingerprint: hostKeyFingerprintSchema,
  state: hostKeyStateSchema,
})

export type TestedHostKey = z.infer<typeof testedHostKeySchema>

// Null for a Channel without a host key, or when the test failed before the server showed one.
export const channelTestResultSchema = z
  .discriminatedUnion('outcome', [
    z.object({
      outcome: z.literal('succeeded'),
      testedAt: z.iso.datetime(),
      hostKey: testedHostKeySchema.nullable().optional(),
    }),
    z.object({
      outcome: z.literal('failed'),
      reason: channelTestResultReasonSchema,
      testedAt: z.iso.datetime(),
      hostKey: testedHostKeySchema.nullable().optional(),
    }),
  ])
  .superRefine((result, context) => {
    const mismatch = result.hostKey?.state === 'mismatch'
    const failedOnMismatch = result.outcome === 'failed' && result.reason === 'hostKeyMismatch'

    if (mismatch !== failedOnMismatch) {
      context.addIssue({
        code: 'custom',
        path: ['hostKey', 'state'],
        message: 'A Channel test fails with hostKeyMismatch exactly when the host key mismatches',
      })
    }
  })

export type ChannelTestResult = z.infer<typeof channelTestResultSchema>

export const testChannelEndpoint: Endpoint<
  ChannelTestResult,
  undefined,
  undefined,
  '/channels/:id/test'
> = {
  method: 'POST',
  path: '/channels/:id/test',
  response: channelTestResultSchema,
}

export const acceptHostKeyBodySchema = z.strictObject({
  hostKeyFingerprint: hostKeyFingerprintSchema,
})

export type AcceptHostKeyBody = z.infer<typeof acceptHostKeyBodySchema>

// The Admin accepts the fingerprint a Channel test showed; the body carries it, so only the key
// the Admin saw is stored, even if the server presents another one in the meantime.
export const acceptHostKeyEndpoint: Endpoint<
  Channel,
  undefined,
  AcceptHostKeyBody,
  '/channels/:id/host-key'
> = {
  method: 'PUT',
  path: '/channels/:id/host-key',
  body: acceptHostKeyBodySchema,
  response: channelSchema,
}
