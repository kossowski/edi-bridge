import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { secretContext } from '@edi-bridge/channels'
import { documentSchema, type WebhookSubmission } from '@edi-bridge/contracts'
import { channels, postgresDocumentStorage } from '@edi-bridge/db'
import { Database, decodeDocument, Documents, receive } from '@edi-bridge/pipeline'

import { ChannelEnvironment } from './channel.js'
import { Db } from './db.js'
import { Unauthorized } from './errors.js'
import { parse } from './parse.js'

// A webhook request carries no file name, so every Document it stores gets this one.
const webhookFileName = 'webhook'

export const bearerTokenSchema = z
  .string()
  .regex(/^bearer \S+$/i)
  .transform((authorization) => authorization.slice('Bearer '.length))

const digest = (token: string) => createHash('sha256').update(token).digest()

// Digests share one length, so the comparison takes the same time for any presented token.
const sameToken = (presented: string, stored: string) =>
  timingSafeEqual(digest(presented), digest(stored))

// An unknown Channel answers like a wrong token, so the route does not reveal which ids exist.
const authenticate = (channelId: string, presented: string | undefined) =>
  Effect.gen(function* () {
    if (presented === undefined || !z.uuid().safeParse(channelId).success) {
      return yield* new Unauthorized()
    }

    const db = yield* Db
    const { secrets } = yield* ChannelEnvironment

    const [channel] = yield* Effect.promise(() =>
      db
        .select({ workspaceId: channels.workspaceId, sealed: channels.encryptedWebhookToken })
        .from(channels)
        .where(and(eq(channels.id, channelId), eq(channels.type, 'webhook'))),
    )

    if (channel?.sealed == null) {
      return yield* new Unauthorized()
    }

    const stored = secrets.open(channel.sealed, secretContext(channelId, 'encryptedWebhookToken'))

    return sameToken(presented, stored)
      ? { workspaceId: channel.workspaceId }
      : yield* new Unauthorized()
  })

export const receiveOnWebhook = (
  channelId: string,
  presentedToken: string | undefined,
  body: Buffer,
) =>
  Effect.gen(function* () {
    const { workspaceId } = yield* authenticate(channelId, presentedToken)
    const content = yield* parse(documentSchema.shape.content, decodeDocument(body))
    const db = yield* Db

    const receipt = yield* receive({
      workspaceId,
      channelId,
      fileName: webhookFileName,
      content,
      manualSubmission: false,
    }).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, postgresDocumentStorage(db)),
    )

    return {
      documentId: receipt.document.id,
      runs: receipt.runs.map(({ id }) => ({ id })),
      notRouted: receipt.notRouted,
    } satisfies WebhookSubmission
  })
