import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import { Clock, Duration, Effect, Schedule } from 'effect'

import { pollingIntervalMinutes } from '@edi-bridge/contracts'
import { channels } from '@edi-bridge/db'

import type { SftpFile } from '@edi-bridge/channels'

import { decodeDocument } from './decode-document'
import { receive } from './receive'
import { Database, Download } from './services'

type InboundChannel = typeof channels.$inferSelect & { pollingIntervalMinutes: number }

type ChannelPolling = {
  polling: boolean
  lastPollAt: number | undefined
  listed: ReadonlyMap<string, SftpFile>
  storedNotRemoved: Set<string>
}

const fileKey = ({ name, size, modifiedAt }: SftpFile) =>
  JSON.stringify([name, size, modifiedAt.getTime()])

const unchanged = (file: SftpFile, previous: SftpFile | undefined) =>
  previous !== undefined &&
  previous.size === file.size &&
  previous.modifiedAt.getTime() === file.modifiedAt.getTime()

const removeStored = (channel: InboundChannel, file: SftpFile, state: ChannelPolling) =>
  Effect.gen(function* () {
    const download = yield* Download

    yield* download.remove(channel, file.name)
    state.storedNotRemoved.delete(fileKey(file))
  })

const storeAndRemove = (
  channel: InboundChannel,
  file: SftpFile,
  content: string,
  state: ChannelPolling,
) =>
  Effect.gen(function* () {
    const documentId = yield* receive({
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      fileName: file.name,
      content,
      manualSubmission: false,
    }).pipe(
      Effect.map(({ document }) => document.id),
      Effect.catchTag('ReceiptRejected', (rejected) =>
        Effect.as(
          Effect.logWarning(`File ${file.name} rejected at receipt: ${rejected.message}`),
          rejected.documentId,
        ),
      ),
    )

    // Without a stored Document the file is the only copy, so it stays on the server.
    if (documentId === undefined) {
      return
    }

    state.storedNotRemoved.add(fileKey(file))
    yield* removeStored(channel, file, state)
  }).pipe(Effect.uninterruptible)

const receiveFile = (channel: InboundChannel, file: SftpFile, state: ChannelPolling) =>
  Effect.gen(function* () {
    const download = yield* Download
    const content = yield* download.read(channel, file.name)

    yield* storeAndRemove(channel, file, decodeDocument(content), state)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(
        `File ${file.name} of Channel ${channel.id} not received or not removed`,
        cause,
      ),
    ),
  )

const pollChannel = (channel: InboundChannel, state: ChannelPolling) =>
  Effect.gen(function* () {
    const download = yield* Download
    const files = yield* download.list(channel)
    const previous = state.listed
    const keys = new Set(files.map(fileKey))

    state.listed = new Map(files.map((file) => [file.name, file]))
    state.storedNotRemoved = new Set([...state.storedNotRemoved].filter((key) => keys.has(key)))

    for (const file of files) {
      if (state.storedNotRemoved.has(fileKey(file))) {
        yield* removeStored(channel, file, state).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`Stored file ${file.name} of Channel ${channel.id} not removed`, cause),
          ),
        )
      } else if (unchanged(file, previous.get(file.name))) {
        yield* receiveFile(channel, file, state)
      }
    }
  })

const inboundSftpChannels = Effect.gen(function* () {
  const db = yield* Database

  return yield* Effect.promise(() =>
    db
      .select({
        ...getTableColumns(channels),
        // The channels_polling_interval check sets an interval on every inbound SFTP Channel.
        pollingIntervalMinutes: sql<number>`${channels.pollingIntervalMinutes}`,
      })
      .from(channels)
      .where(and(eq(channels.type, 'sftp'), eq(channels.direction, 'inbound'))),
  )
})

export const pollInboundChannels = (minute: Duration.Input = Duration.minutes(1)) =>
  Effect.gen(function* () {
    const minuteLength = Duration.fromInputUnsafe(minute)
    // Polling intervals are whole minutes, so a check every minute meets each of them.
    const checkEvery = Duration.times(minuteLength, pollingIntervalMinutes.min)
    const states = new Map<string, ChannelPolling>()

    // Each check reads the Channels again, so a created or changed one needs no restart.
    const pollDue = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const inbound = yield* inboundSftpChannels
      const ids = new Set(inbound.map(({ id }) => id))

      for (const id of states.keys()) {
        if (!ids.has(id)) {
          states.delete(id)
        }
      }

      for (const channel of inbound) {
        const state = states.get(channel.id) ?? {
          polling: false,
          lastPollAt: undefined,
          listed: new Map(),
          storedNotRemoved: new Set(),
        }

        const interval = Duration.toMillis(
          Duration.times(minuteLength, channel.pollingIntervalMinutes),
        )

        states.set(channel.id, state)

        // A poll still running holds the next one back, so no file is received twice.
        if (
          state.polling ||
          (state.lastPollAt !== undefined && now - state.lastPollAt < interval)
        ) {
          continue
        }

        state.polling = true
        state.lastPollAt = now

        // Each Channel polls in its own fiber, so a failure or defect stops only that Channel.
        yield* pollChannel(channel, state).pipe(
          Effect.catchCause((cause) =>
            Effect.logError(`Inbound Channel ${channel.id} not polled`, cause),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              state.polling = false
            }),
          ),
          Effect.forkChild,
        )
      }
    })

    return yield* pollDue.pipe(
      Effect.catchCause((cause) => Effect.logError('Inbound Channels not polled', cause)),
      Effect.repeat(Schedule.fixed(checkEvery)),
    )
  })
