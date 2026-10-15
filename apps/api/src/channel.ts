import { eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import { randomInt, randomUUID } from 'node:crypto'

import {
  type Channel,
  type ChannelInput,
  channelSchema,
  type ChannelUpdate,
  type CreatedChannel,
  type MaskedSecret,
  type RegeneratedWebhookToken,
  toPath,
  webhookPath,
  webhookTokenSchema,
} from '@edi-bridge/contracts'
import { channels } from '@edi-bridge/db'

import { Db, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { byName, exactlyOne, inWorkspace, rejectingInvalidId, writingInWorkspace } from './rows.js'
import { assertTradingPartnerIn } from './trading-partner.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'
import type { SecretBox } from './secret.js'

export interface ChannelSettings {
  secretKey: Buffer
  apiPublicUrl: string
}

export class ChannelEnvironment extends Context.Service<
  ChannelEnvironment,
  { readonly secrets: SecretBox; readonly apiPublicUrl: string }
>()('ChannelEnvironment') {}

type Row = typeof channels.$inferSelect

type Values = Omit<typeof channels.$inferInsert, 'workspaceId'>

type Kind = Channel['type']

type OfKind<T, K extends Kind> = Extract<T, { type: K }>

export type SecretColumn =
  'encryptedCredential' | 'encryptedWebhookToken' | 'encryptedAuthorization'

const hidden: MaskedSecret = { lastFour: null }

const tokenAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const newWebhookToken = () =>
  webhookTokenSchema.parse(
    `whk_${Array.from({ length: 32 }, () => tokenAlphabet[randomInt(tokenAlphabet.length)]).join('')}`,
  )

// Senders outside the browser call the webhook URL, so it is absolute.
const webhookUrl = (apiPublicUrl: string, id: string) =>
  `${apiPublicUrl.replace(/\/$/, '')}${toPath(webhookPath, { id })}`

export const secretContext = (id: string, column: SecretColumn) => `channels/${id}/${column}`

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
}

type KindHandlings = { [K in Kind]: KindHandling<K> }

const kinds: KindHandlings = {
  sftp: {
    responseFields: (row) => ({
      host: row.host,
      port: row.port,
      username: row.username,
      remotePath: row.remotePath,
      authentication: row.authentication,
      credential: hidden,
      ...(row.direction === 'inbound' && { pollingIntervalMinutes: row.pollingIntervalMinutes }),
    }),
    columns: (input) => ({
      host: input.host,
      port: input.port,
      username: input.username,
      remotePath: input.remotePath,
      authentication: input.authentication,
      pollingIntervalMinutes: input.direction === 'inbound' ? input.pollingIntervalMinutes : null,
    }),
    createdSecrets: (secrets, id, input) => ({
      columns: sealed(secrets, id, 'encryptedCredential', input.credential),
      webhookToken: null,
    }),
    changedSecrets: (secrets, id, input) =>
      input.credential === undefined
        ? {}
        : sealed(secrets, id, 'encryptedCredential', input.credential),
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

const updatingRow = (id: string, values: Partial<Values>, tradingPartnerId: string | null) =>
  Effect.gen(function* () {
    const { apiPublicUrl } = yield* ChannelEnvironment

    const [row] = yield* writingWithTradingPartner(tradingPartnerId, (tx, workspaceId) =>
      tx
        .update(channels)
        .set(values)
        .where(inWorkspace(channels, workspaceId, byId(id)))
        .returning(),
    )

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
