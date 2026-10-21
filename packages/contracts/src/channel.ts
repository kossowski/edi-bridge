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

// A passphrase is read back only as stored: even its last characters would help guess it.
export const hiddenSecretSchema = z.strictObject({ lastFour: z.null() })

export type HiddenSecret = z.infer<typeof hiddenSecretSchema>

export const maxChannelNameLength = 70

// The last of the 43 base64 characters carries only 4 bits of the 32-byte hash.
export const hostKeyFingerprintSchema = z
  .string()
  .trim()
  .regex(/^SHA256:[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/)

export type HostKeyFingerprint = z.infer<typeof hostKeyFingerprintSchema>

export const channelTestFailureReasons = [
  'hostKeyMismatch',
  'loginRejected',
  'hostUnreachable',
  'timedOut',
  'remotePathMissing',
  'permissionDenied',
  'unexpectedResponse',
  'addressBlocked',
  'passphraseRejected',
] as const

export const channelTestFailureReasonSchema = z.enum(channelTestFailureReasons)

export type ChannelTestFailureReason = z.infer<typeof channelTestFailureReasonSchema>

// An IPv4-mapped IPv6 address stays as resolved, so the Admin sees the address that was refused.
export const blockedAddressSchema = z.union([z.ipv4(), z.ipv6()])

const namesBlockedAddress = (failure: { reason: string; blockedAddress?: string | undefined }) =>
  (failure.reason === 'addressBlocked') === (failure.blockedAddress !== undefined)

const blockedAddressIssue = {
  path: ['blockedAddress'],
  message: 'A failure names the blocked address exactly when its reason is addressBlocked',
}

export const pollProblemSchema = z
  .strictObject({
    reason: channelTestFailureReasonSchema,
    since: z.iso.datetime(),
    blockedAddress: blockedAddressSchema.optional(),
  })
  .refine(namesBlockedAddress, blockedAddressIssue)

export type PollProblem = z.infer<typeof pollProblemSchema>

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
  Passphrase extends z.ZodType,
  PollingInterval extends z.ZodType,
  Webhook extends Record<string, z.ZodType>,
  Authorization extends z.ZodType,
  Polling extends Record<string, z.ZodType>,
>(
  object: <Fields extends Record<string, z.ZodType>>(
    fields: Fields,
  ) => z.ZodObject<z.core.util.Writeable<Fields>, Config>,
  parts: {
    common: Common
    credential: Credential
    passphrase: Passphrase
    pollingInterval: PollingInterval
    webhook: Webhook
    authorization: Authorization
    polling: Polling
  },
) {
  const { common, credential, passphrase, pollingInterval, webhook, authorization, polling } = parts

  return z.discriminatedUnion('type', [
    z.discriminatedUnion('direction', [
      object({
        ...common,
        ...literals(inboundSftp),
        ...channelIdentity,
        ...sftpConnection,
        pollingIntervalMinutes: pollingInterval,
        credential,
        passphrase,
        hostKeyFingerprint: hostKeyFingerprintSchema.nullable().optional(),
        ...polling,
      }),
      object({
        ...common,
        ...literals(outboundSftp),
        ...channelIdentity,
        ...sftpConnection,
        credential,
        passphrase,
        hostKeyFingerprint: hostKeyFingerprintSchema.nullable().optional(),
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

// Only a private key takes a passphrase; null, which removes the stored one, fits any Channel.
function unlocksPrivateKey(channel: {
  type: ChannelType
  authentication?: SftpAuthentication
  passphrase?: unknown
}) {
  return (
    channel.passphrase === undefined ||
    channel.passphrase === null ||
    channel.authentication === 'privateKey'
  )
}

const passphraseIssue = {
  path: ['passphrase'],
  message: 'Only a Channel that authenticates with a private key takes a passphrase',
}

export const channelInputSchema = channelUnion(z.object, {
  common: {},
  credential: secretInputSchema,
  passphrase: secretInputSchema.optional(),
  pollingInterval: pollingIntervalSchema.default(pollingIntervalMinutes.default),
  webhook: {},
  authorization: secretInputSchema.nullable(),
  polling: {},
}).refine(unlocksPrivateKey, passphraseIssue)

export type ChannelInput = z.infer<typeof channelInputSchema>

// Omitting a secret or fingerprint keeps the stored one; null removes it.
export const channelUpdateSchema = channelUnion(z.object, {
  common: {},
  credential: secretInputSchema.optional(),
  passphrase: secretInputSchema.nullable().optional(),
  pollingInterval: pollingIntervalSchema,
  webhook: {},
  authorization: secretInputSchema.nullable().optional(),
  polling: {},
}).refine(unlocksPrivateKey, passphraseIssue)

export type ChannelUpdate = z.infer<typeof channelUpdateSchema>

// Strict objects, so a response that leaks a plaintext secret fails to parse.
export const channelSchema = channelUnion(z.strictObject, {
  common: { id: z.uuid() },
  credential: maskedSecretSchema,
  passphrase: hiddenSecretSchema.nullable().optional(),
  pollingInterval: pollingIntervalSchema,
  webhook: { url: z.url(), token: maskedSecretSchema },
  authorization: maskedSecretSchema.nullable(),
  polling: { pollProblem: pollProblemSchema.nullable() },
}).refine(unlocksPrivateKey, passphraseIssue)

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

// The API refuses to test a seeded Channel before reaching it, so no reach fails with this reason.
export const channelTestResultReasonSchema = z.enum([...channelTestFailureReasons, 'seededChannel'])

export type ChannelTestResultReason = z.infer<typeof channelTestResultReasonSchema>

export const hostKeyStates = ['matches', 'mismatch', 'unchecked'] as const

export const hostKeyStateSchema = z.enum(hostKeyStates)

export type HostKeyState = z.infer<typeof hostKeyStateSchema>

export const testedHostKeySchema = z.object({
  fingerprint: hostKeyFingerprintSchema,
  state: hostKeyStateSchema,
})

export type TestedHostKey = z.infer<typeof testedHostKeySchema>

const channelTestFields = {
  testedAt: z.iso.datetime(),
  hostKey: testedHostKeySchema.nullable().optional(),
}

export const channelTestResultSchema = z
  .discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('succeeded'), ...channelTestFields }),
    z.object({
      outcome: z.literal('failed'),
      reason: channelTestResultReasonSchema,
      blockedAddress: blockedAddressSchema.optional(),
      ...channelTestFields,
    }),
  ])
  .superRefine((result, context) => {
    if (result.outcome === 'failed' && !namesBlockedAddress(result)) {
      context.addIssue({ code: 'custom', ...blockedAddressIssue })
    }

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

// The body pins the key the Admin saw, in case the server presents another one meanwhile.
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
