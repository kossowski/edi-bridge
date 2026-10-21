import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import { Cause, Clock, Duration, Effect, Option, Schedule } from 'effect'

import { DownloadFailed, type SftpFile } from '@edi-bridge/channels'
import { pollingIntervalMinutes } from '@edi-bridge/contracts'
import { channels } from '@edi-bridge/db'

import { type DecodedDocument, decodeDocument } from './decode-document'
import { defectSource, type DefectSource } from './defect-report'
import { receive } from './receive'
import { Database, Download } from './services'

type InboundChannel = typeof channels.$inferSelect & { pollingIntervalMinutes: number }

type ChannelPolling = {
  polling: boolean
  lastPollAt: number | undefined
  listed: ReadonlyMap<string, SftpFile>
  storedNotRemoved: Set<string>
  defects: DefectSource
}

const channelDefect = (channel: InboundChannel) =>
  ({
    workspaceId: channel.workspaceId,
    runId: null,
    tradingPartnerId: null,
    channelId: channel.id,
    code: 'channelDefect',
  }) as const

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
  content: DecodedDocument,
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
    Effect.catchCause(
      state.defects.logAndReport(
        `File ${file.name} of Channel ${channel.id} not received or not removed`,
      ),
    ),
  )

const downloadFailure = (cause: Cause.Cause<unknown>) =>
  Cause.findErrorOption(cause).pipe(
    Option.filter((error): error is DownloadFailed => error instanceof DownloadFailed),
  )

const reasonOf = (cause: Cause.Cause<unknown>) =>
  downloadFailure(cause).pipe(
    Option.match({ onNone: () => '', onSome: ({ reason }) => `: ${reason}` }),
  )

type PollProblem = Pick<
  InboundChannel,
  'pollProblemReason' | 'pollProblemSince' | 'pollProblemBlockedAddress'
>

const setPollProblem = (channel: InboundChannel, pollProblem: PollProblem) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* Effect.promise(() =>
      db.update(channels).set(pollProblem).where(eq(channels.id, channel.id)),
    )
  })

// A poll problem tells since when polling fails, so a new failure for the same reason keeps that time.
const storePollProblem = (channel: InboundChannel, cause: Cause.Cause<unknown>, since: Date) =>
  Option.match(downloadFailure(cause), {
    onNone: () => Effect.void,
    onSome: ({ reason, blockedAddress = null }) => {
      const sameReason = reason === channel.pollProblemReason

      return sameReason && blockedAddress === channel.pollProblemBlockedAddress
        ? Effect.void
        : setPollProblem(channel, {
            pollProblemReason: reason,
            pollProblemSince: sameReason ? channel.pollProblemSince : since,
            pollProblemBlockedAddress: blockedAddress,
          })
    },
  })

const clearPollProblem = (channel: InboundChannel) =>
  channel.pollProblemReason === null
    ? Effect.void
    : setPollProblem(channel, {
        pollProblemReason: null,
        pollProblemSince: null,
        pollProblemBlockedAddress: null,
      })

const pollChannel = (channel: InboundChannel, state: ChannelPolling) =>
  Effect.gen(function* () {
    const download = yield* Download
    const files = yield* download.list(channel)

    yield* clearPollProblem(channel)

    const previous = state.listed
    const keys = new Set(files.map(fileKey))

    state.listed = new Map(files.map((file) => [file.name, file]))
    state.storedNotRemoved = new Set([...state.storedNotRemoved].filter((key) => keys.has(key)))

    for (const file of files) {
      if (state.storedNotRemoved.has(fileKey(file))) {
        yield* removeStored(channel, file, state).pipe(
          Effect.catchCause(
            state.defects.logAndReport(
              `Stored file ${file.name} of Channel ${channel.id} not removed`,
            ),
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
      .where(
        and(
          eq(channels.type, 'sftp'),
          eq(channels.direction, 'inbound'),
          // A seeded Channel names a reserved .invalid host, so seeded traffic never reaches a real server.
          eq(channels.seeded, false),
        ),
      ),
  )
})

export const pollInboundChannels = (minute: Duration.Input = Duration.minutes(1)) =>
  Effect.gen(function* () {
    const minuteLength = Duration.fromInputUnsafe(minute)
    // Polling intervals are whole minutes, so a check every minute meets each of them.
    const checkEvery = Duration.times(minuteLength, pollingIntervalMinutes.min)
    const states = new Map<string, ChannelPolling>()

    const loopDefects = defectSource({
      workspaceId: null,
      runId: null,
      tradingPartnerId: null,
      channelId: null,
      code: 'pollingDefect',
    })

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
          defects: defectSource(channelDefect(channel)),
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
          state.defects.succeeding,
          // A failed poll stores its reason on the Channel; a defect is reported and stores none.
          Effect.catchCause((cause) =>
            state.defects
              .logAndReport(`Inbound Channel ${channel.id} not polled${reasonOf(cause)}`)(cause)
              .pipe(Effect.andThen(storePollProblem(channel, cause, new Date(now)))),
          ),
          Effect.catchCause(
            state.defects.logAndReport(`Poll problem of Inbound Channel ${channel.id} not stored`),
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
      loopDefects.succeeding,
      Effect.catchCause(loopDefects.logAndReport('Inbound Channels not polled')),
      Effect.repeat(Schedule.fixed(checkEvery)),
    )
  })
