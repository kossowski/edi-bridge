import { eq, or } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import { randomInt, randomUUID } from 'node:crypto'

import {
  ChannelReach,
  type ChannelUnreachable,
  type SecretBox,
  type SecretColumn,
  secretContext,
} from '@edi-bridge/channels'
import {
  type AcceptHostKeyBody,
  type Channel,
  type ChannelInput,
  channelSchema,
  type ChannelTestResult,
  type ChannelUpdate,
  type CreatedChannel,
  type MaskedSecret,
  type RegeneratedWebhookToken,
  type TestedHostKey,
  toPath,
  webhookPath,
  webhookTokenSchema,
} from '@edi-bridge/contracts'
import { channels, flows } from '@edi-bridge/db'

import { Db, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { byName, exactlyOne, inWorkspace, rejectingInvalidId, writingInWorkspace } from './rows.js'
import { assertTradingPartnerIn } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

export interface ChannelSettings {
  secretKey: Buffer
  apiPublicUrl: string
  reachTimeoutMs: number
  allowedHosts: readonly string[]
}

export class ChannelEnvironment extends Context.Service<
  ChannelEnvironment,
  { readonly secrets: SecretBox; readonly apiPublicUrl: string }
>()('ChannelEnvironment') {}

type Row = typeof channels.$inferSelect

type Values = Omit<typeof channels.$inferInsert, 'workspaceId'>

type Kind = Channel['type']

type OfKind<T, K extends Kind> = Extract<T, { type: K }>

const hidden: MaskedSecret = { lastFour: null }

const tokenAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const newWebhookToken = () =>
  webhookTokenSchema.parse(
    `whk_${Array.from({ length: 32 }, () => tokenAlphabet[randomInt(tokenAlphabet.length)]).join('')}`,
  )

// Senders outside the browser call the webhook URL, so it is absolute.
const webhookUrl = (apiPublicUrl: string, id: string) =>
  `${apiPublicUrl.replace(/\/$/, '')}${toPath(webhookPath, { id })}`

const sealed = (secrets: SecretBox, id: string, column: SecretColumn, plaintext: string) => ({
  [column]: secrets.seal(plaintext, secretContext(id, column)),
})

const sealedToken = (secrets: SecretBox, id: string, token: string) => ({
  ...sealed(secrets, id, 'encryptedWebhookToken', token),
  webhookTokenLastFour: token.slice(-4),
})

interface KindHandling<K extends Kind> {
  responseFields: (row: Row, apiPublicUrl: string) => object
  columns: (input: OfKind<ChannelInput | ChannelUpdate, K>) => Partial<Values>
  createdSecrets: (
    secrets: SecretBox,
    id: string,
    input: OfKind<ChannelInput, K>,
  ) => { columns: Partial<Values>; webhookToken: string | null }
  changedSecrets: (
    secrets: SecretBox,
    id: string,
    input: OfKind<ChannelUpdate, K>,
  ) => Partial<Values>
  reach: (
    channel: OfKind<Channel, K>,
    secret: (column: SecretColumn) => string | null,
  ) => Effect.Effect<TestedHostKey | null, ChannelUnreachable, ChannelReach>
}

type KindHandlings = { [K in Kind]: KindHandling<K> }

const pollProblemOf = ({ pollProblemReason, pollProblemSince }: Row) =>
  pollProblemReason === null || pollProblemSince === null
    ? null
    : { reason: pollProblemReason, since: pollProblemSince.toISOString() }

const kinds: KindHandlings = {
  sftp: {
    responseFields: (row) => ({
      host: row.host,
      port: row.port,
      username: row.username,
      remotePath: row.remotePath,
      authentication: row.authentication,
      credential: hidden,
      hostKeyFingerprint: row.hostKeyFingerprint,
      ...(row.direction === 'inbound' && {
        pollingIntervalMinutes: row.pollingIntervalMinutes,
        pollProblem: pollProblemOf(row),
      }),
    }),
    columns: (input) => ({
      host: input.host,
      port: input.port,
      username: input.username,
      remotePath: input.remotePath,
      authentication: input.authentication,
      pollingIntervalMinutes: input.direction === 'inbound' ? input.pollingIntervalMinutes : null,
      ...(input.hostKeyFingerprint !== undefined && {
        hostKeyFingerprint: input.hostKeyFingerprint,
      }),
    }),
    createdSecrets: (secrets, id, input) => ({
      columns: sealed(secrets, id, 'encryptedCredential', input.credential),
      webhookToken: null,
    }),
    changedSecrets: (secrets, id, input) =>
      input.credential === undefined
        ? {}
        : sealed(secrets, id, 'encryptedCredential', input.credential),
    reach: (
      { host, port, username, remotePath, authentication, hostKeyFingerprint = null },
      secret,
    ) => {
      const credential = secret('encryptedCredential') ?? ''

      return Effect.flatMap(ChannelReach, (reach) =>
        reach.sftp({
          host,
          port,
          username,
          remotePath,
          hostKeyFingerprint,
          credential:
            authentication === 'password' ? { password: credential } : { privateKey: credential },
        }),
      )
    },
  },
  webhook: {
    responseFields: (row, apiPublicUrl) => ({
      rateLimitPerMinute: row.rateLimitPerMinute,
      url: webhookUrl(apiPublicUrl, row.id),
      token: { lastFour: row.webhookTokenLastFour },
    }),
    columns: (input) => ({ rateLimitPerMinute: input.rateLimitPerMinute }),
    createdSecrets: (secrets, id) => {
      const webhookToken = newWebhookToken()

      return { columns: sealedToken(secrets, id, webhookToken), webhookToken }
    },
    changedSecrets: () => ({}),
    reach: () => Effect.succeed(null),
  },
  http: {
    responseFields: (row) => ({
      url: row.url,
      authorization: row.encryptedAuthorization === null ? null : hidden,
    }),
    columns: (input) => ({ url: input.url }),
    createdSecrets: (secrets, id, input) => ({
      columns:
        input.authorization === null
          ? {}
          : sealed(secrets, id, 'encryptedAuthorization', input.authorization),
      webhookToken: null,
    }),
    changedSecrets: (secrets, id, input) => {
      if (input.authorization === undefined) {
        return {}
      }

      return input.authorization === null
        ? { encryptedAuthorization: null }
        : sealed(secrets, id, 'encryptedAuthorization', input.authorization)
    },
    reach: (channel, secret) =>
      Effect.flatMap(ChannelReach, (reach) =>
        Effect.as(
          reach.http({ url: channel.url, authorization: secret('encryptedAuthorization') }),
          null,
        ),
      ),
  },
}

const handlingOf = <K extends Kind>(type: K): KindHandling<K> => kinds[type]

const identityOf = ({
  type,
  direction,
  name,
  tradingPartnerId,
}: Row | ChannelInput | ChannelUpdate) =>
  ({ type, direction, name, tradingPartnerId }) satisfies Partial<Values>

const toChannel = (row: Row, apiPublicUrl: string): Channel =>
  channelSchema.parse({
    id: row.id,
    ...identityOf(row),
    ...handlingOf(row.type).responseFields(row, apiPublicUrl),
  })

const columnsOf = (input: ChannelInput | ChannelUpdate) => ({
  ...identityOf(input),
  ...handlingOf(input.type).columns(input),
})

const byId = (id: string) => eq(channels.id, id)

export const listChannels = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace
  const { apiPublicUrl } = yield* ChannelEnvironment

  const rows = yield* Effect.promise(() =>
    db.select().from(channels).where(inWorkspace(channels, workspace.id)),
  )

  return rows.map((row) => toChannel(row, apiPublicUrl)).toSorted(byName)
})

const loadRow = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      db
        .select()
        .from(channels)
        .where(inWorkspace(channels, workspace.id, byId(id))),
    )

    return row ?? (yield* new NotFound())
  })

export const loadChannel = (id: string) =>
  Effect.gen(function* () {
    const row = yield* loadRow(id)
    const { apiPublicUrl } = yield* ChannelEnvironment

    return toChannel(row, apiPublicUrl)
  })

const writingWithTradingPartner = <A>(
  tradingPartnerId: string | null,
  write: (tx: Transaction, workspaceId: string) => Promise<A>,
) =>
  writingInWorkspace(async (tx, workspaceId) => {
    await assertTradingPartnerIn(tx, workspaceId, tradingPartnerId)

    return write(tx, workspaceId)
  })

export const createChannel = (input: ChannelInput) =>
  Effect.gen(function* () {
    const { secrets, apiPublicUrl } = yield* ChannelEnvironment

    const id = randomUUID()
    const secretColumns = handlingOf(input.type).createdSecrets(secrets, id, input)

    const values = { id, ...columnsOf(input), ...secretColumns.columns }

    const rows = yield* writingWithTradingPartner(input.tradingPartnerId, (tx, workspaceId) =>
      tx
        .insert(channels)
        .values({ ...values, workspaceId })
        .returning(),
    )

    return {
      channel: toChannel(yield* exactlyOne(rows), apiPublicUrl),
      webhookToken: secretColumns.webhookToken,
    } satisfies CreatedChannel
  })

const rejectingUnchangeable = (existing: Row, changes: ChannelUpdate) => {
  if (changes.type !== existing.type || changes.direction !== existing.direction) {
    return Effect.fail(
      new Conflict({ message: 'The type and direction of a Channel cannot change' }),
    )
  }

  if (
    changes.type === 'sftp' &&
    changes.credential === undefined &&
    changes.authentication !== existing.authentication
  ) {
    return Effect.fail(
      new Unprocessable({
        message: 'A new credential is required when the authentication method changes',
      }),
    )
  }

  return Effect.void
}

const tradingPartnerFixed = () =>
  new Conflict({ message: 'The Trading Partner of a Channel cannot change while a Flow uses it' })

// The lock waits for a Flow being created with this Channel, so the check below sees it.
const assertTradingPartnerChangeable = async (
  tx: Transaction,
  workspaceId: string,
  id: string,
  tradingPartnerId: string | null,
) => {
  const [locked] = await tx
    .select({ tradingPartnerId: channels.tradingPartnerId })
    .from(channels)
    .where(inWorkspace(channels, workspaceId, byId(id)))
    .for('update')

  if (!locked || locked.tradingPartnerId === tradingPartnerId) {
    return
  }

  const [used] = await tx
    .select({ id: flows.id })
    .from(flows)
    .where(or(eq(flows.inboundChannelId, id), eq(flows.destinationChannelId, id)))
    .limit(1)

  if (used) {
    throw tradingPartnerFixed()
  }
}

const updatingRow = (id: string, values: Partial<Values>, tradingPartnerId: string | null) =>
  Effect.gen(function* () {
    const { apiPublicUrl } = yield* ChannelEnvironment

    const [row] = yield* writingWithTradingPartner(tradingPartnerId, async (tx, workspaceId) => {
      await assertTradingPartnerChangeable(tx, workspaceId, id, tradingPartnerId)

      return tx
        .update(channels)
        .set(values)
        .where(inWorkspace(channels, workspaceId, byId(id)))
        .returning()
    })

    return row ? toChannel(row, apiPublicUrl) : yield* new NotFound()
  })

export const updateChannel = (id: string, input: Effect.Effect<ChannelUpdate, ValidationError>) =>
  Effect.gen(function* () {
    const existing = yield* loadRow(id)
    const changes = yield* input
    const { secrets } = yield* ChannelEnvironment

    yield* rejectingUnchangeable(existing, changes)

    return yield* updatingRow(
      id,
      { ...columnsOf(changes), ...handlingOf(changes.type).changedSecrets(secrets, id, changes) },
      changes.tradingPartnerId,
    )
  })

export const regenerateWebhookToken = (id: string) =>
  Effect.gen(function* () {
    const existing = yield* loadRow(id)
    const { secrets } = yield* ChannelEnvironment

    if (existing.type !== 'webhook') {
      return yield* new Conflict({ message: 'Only webhook Channels have a token' })
    }

    const webhookToken = newWebhookToken()

    const channel = yield* updatingRow(
      id,
      sealedToken(secrets, id, webhookToken),
      existing.tradingPartnerId,
    )

    return { channel, webhookToken } satisfies RegeneratedWebhookToken
  })

export const acceptHostKey = (
  id: string,
  input: Effect.Effect<AcceptHostKeyBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const existing = yield* loadRow(id)
    const { hostKeyFingerprint } = yield* input

    if (existing.type !== 'sftp') {
      return yield* new Conflict({ message: 'Only SFTP Channels have a host key' })
    }

    return yield* updatingRow(id, { hostKeyFingerprint }, existing.tradingPartnerId)
  })

const secretOf =
  (secrets: SecretBox, row: Row) =>
  (column: SecretColumn): string | null => {
    const sealedSecret = row[column]

    return sealedSecret === null ? null : secrets.open(sealedSecret, secretContext(row.id, column))
  }

export const testChannel = (id: string) =>
  Effect.gen(function* () {
    const row = yield* loadRow(id)
    const { secrets, apiPublicUrl } = yield* ChannelEnvironment
    const channel = toChannel(row, apiPublicUrl)

    // A seeded Channel points at a reserved host and never connects, not even for a test.
    const { reason, hostKey, blockedAddress } = row.seeded
      ? { reason: 'seededChannel' as const, hostKey: null, blockedAddress: undefined }
      : yield* handlingOf(channel.type)
          .reach(channel, secretOf(secrets, row))
          .pipe(
            Effect.map((hostKey) => ({ reason: null, hostKey, blockedAddress: undefined })),
            Effect.catchTag('ChannelUnreachable', ({ reason, hostKey = null, blockedAddress }) =>
              Effect.succeed({ reason, hostKey, blockedAddress }),
            ),
          )

    const testedAt = new Date().toISOString()

    return (
      reason === null
        ? { outcome: 'succeeded', hostKey, testedAt }
        : {
            outcome: 'failed',
            reason,
            hostKey,
            testedAt,
            ...(blockedAddress && { blockedAddress }),
          }
    ) satisfies ChannelTestResult
  })
