import { eq, sql } from 'drizzle-orm'
import { Cause, Clock, Duration, Effect, Exit, Fiber, Logger, Option, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DownloadFailed,
  secretBox,
  secretKeyBytes,
  sftpChannelDownload,
  addressPolicy,
} from '@edi-bridge/channels'
import {
  mismatchingHostKeyFingerprint,
  startTestSftpServer,
  type TestSftpServer,
  testAllowedHosts,
} from '@edi-bridge/channels/testing'
import { channels, connect, type Connection, documents, runs, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import {
  DefectReporter,
  Download,
  type DownloadService,
  pollInboundChannels,
  processRun,
} from './index'
import {
  addOrdersFlow,
  breakingDatabase,
  defectReportsIn,
  golden,
  goldenInvoice,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  markSeeded,
  pipelineServices,
  readRun,
  receiveOverSftp,
  recordingDefectReporter,
  seedInvoiceWorkspace,
  testSecrets,
} from './testing'

let testDatabase: TestDatabase

let connection: Connection

let workspace: InvoiceWorkspace

let sftp: TestSftpServer

beforeAll(async () => {
  ;[testDatabase, sftp] = await Promise.all([startTestDatabase(), startTestSftpServer()])
  connection = connect(testDatabase.url)
}, 180_000)

afterAll(async () => {
  await connection.close()
  await Promise.all([testDatabase.stop(), sftp.stop()])
})

const ordersInterchange = golden('orders-reference.edi', 'latin1')

const ordersMessage = ordersInterchange
  .split('\n')
  .filter((line) => line !== '' && !/^UN[BZ]/.test(line))

const threeOrders = [
  ordersInterchange.split('\n')[0],
  ...ordersMessage,
  ...ordersMessage,
  ...ordersMessage,
  "UNZ+3+00000001'",
].join('\n')

type RemoteFile = { content: Buffer; modifiedAt: Date }

// An SSH session per operation takes about half a second, so most Channels list from memory.
const remotePaths = new Map<string, Map<string, RemoteFile>>()

const remotePathOf = (channelId: string) =>
  Effect.suspend(() => {
    const files = remotePaths.get(channelId)

    return files === undefined
      ? Effect.fail(new DownloadFailed({ reason: 'remotePathMissing' }))
      : Effect.succeed(files)
  })

const memoryDownload: DownloadService = {
  list: (channel) =>
    Effect.map(remotePathOf(channel.id), (files) =>
      [...files].map(([name, { content, modifiedAt }]) => ({
        name,
        size: content.length,
        modifiedAt,
      })),
    ),
  read: (channel, name) =>
    Effect.flatMap(remotePathOf(channel.id), (files) => {
      const file = files.get(name)

      return file === undefined
        ? Effect.fail(new DownloadFailed({ reason: 'remotePathMissing' }))
        : Effect.succeed(file.content)
    }),
  remove: (channel, name) =>
    Effect.map(remotePathOf(channel.id), (files) => {
      files.delete(name)
    }),
}

const sftpLogin = {
  username: 'edi_bridge',
  password: 'edi-bridge-sftp-password',
  remotePath: '/outbox',
}

const sftpDownload = sftpChannelDownload({
  secrets: testSecrets,
  timeoutMs: 5000,
  addressPolicy: addressPolicy(testAllowedHosts),
})

const inMemory = (channelId: string) => remotePaths.has(channelId)

const download: DownloadService = {
  list: (channel) =>
    inMemory(channel.id) ? memoryDownload.list(channel) : sftpDownload.list(channel),
  read: (channel, name) =>
    inMemory(channel.id) ? memoryDownload.read(channel, name) : sftpDownload.read(channel, name),
  remove: (channel, name) =>
    inMemory(channel.id)
      ? memoryDownload.remove(channel, name)
      : sftpDownload.remove(channel, name),
}

type Call = { operation: 'list' | 'read' | 'remove'; channelId: string; name?: string }

// Records each finished call, so a test knows a poll got that far.
const recorded = (service: DownloadService) => {
  const calls: Call[] = []

  const noting = (call: Call) => Effect.ensuring(Effect.sync(() => calls.push(call)))

  const recording: DownloadService = {
    list: (channel) =>
      service.list(channel).pipe(noting({ operation: 'list', channelId: channel.id })),
    read: (channel, name) =>
      service.read(channel, name).pipe(noting({ operation: 'read', channelId: channel.id, name })),
    remove: (channel, name) =>
      service
        .remove(channel, name)
        .pipe(noting({ operation: 'remove', channelId: channel.id, name })),
  }

  return { calls, service: recording }
}

// Waits chain up to four times in a test, which must stay well under 3 s.
const wait = { timeout: 500, interval: 10 }

let stopPolling: (() => Promise<void>) | undefined

// The poller sees every inbound SFTP Channel, so each test brings its own Workspace.
beforeEach(async () => {
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
})

afterEach(async () => {
  await stopPolling?.()
  stopPolling = undefined
  remotePaths.clear()
  await connection.db.delete(workspaces).where(eq(workspaces.id, workspace.id))
})

type PollLog = { message: unknown; cause: Cause.Cause<unknown> }

const startPolling = async (
  service: DownloadService = download,
  logs: PollLog[] = [],
  { db = connection.db, defects = recordingDefectReporter() } = {},
) => {
  const recording = recorded(service)
  const scope = await Effect.runPromise(Scope.make())
  const clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(scope)))

  const startedAt = Date.now()

  await Effect.runPromise(clock.setTime(startedAt))

  let sleeps = 0

  // Counts each sleep of the poller, so a test knows a check ended before the clock moves on.
  const countingClock: Clock.Clock = {
    ...clock,
    sleep: (duration) =>
      Effect.suspend(() => {
        sleeps += 1

        return clock.sleep(duration)
      }),
  }

  const polling = Effect.runFork(
    pollInboundChannels().pipe(
      Effect.provideService(DefectReporter, defects.service),
      pipelineServices(db, inMemoryRunQueue()),
      Effect.provideService(Download, recording.service),
      Effect.provideService(Clock.Clock, countingClock),
      Effect.provide(
        Logger.layer([Logger.make(({ message, cause }) => logs.push({ message, cause }))]),
      ),
    ),
  )

  stopPolling = async () => {
    await Effect.runPromise(Fiber.interrupt(polling))
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }

  const operations = (channelId: string) =>
    recording.calls.filter((call) => call.channelId === channelId).map(({ operation }) => operation)

  const lists = (channelId: string) =>
    operations(channelId).filter((operation) => operation === 'list').length

  const minutesPass = async (minutes: number) => {
    await Effect.runPromise(clock.adjust(Duration.minutes(minutes)))
  }

  const polled = (channelId: string, times: number) =>
    vi.waitFor(() => {
      expect(lists(channelId)).toBe(times)
    }, wait)

  return {
    startedAt: new Date(startedAt),
    calls: recording.calls,
    lists,
    operations,
    minutesPass,
    sleeps: () => sleeps,
    polled,
    // A file is received at the second poll that lists it unchanged.
    pollAgain: async (channelId: string, times = 1) => {
      await polled(channelId, times)
      await minutesPass(1)
    },
    // A poll that receives a file ends after its last call, and holds the next poll back until then.
    polledOnceMore: (channelId: string, times: number) =>
      vi.waitFor(async () => {
        await minutesPass(1)
        expect(lists(channelId)).toBeGreaterThanOrEqual(times)
      }, wait),
  }
}

type Placing = { encoding?: BufferEncoding; modifiedAt?: Date }

const outbox = async (
  files: Record<string, string> = {},
  options: Parameters<typeof receiveOverSftp>[3] = {},
) => {
  const channelId = await receiveOverSftp(
    connection.db,
    workspace,
    { host: 'sftp.invalid', port: 22, ...sftpLogin },
    options,
  )

  const remote = new Map<string, RemoteFile>()

  remotePaths.set(channelId, remote)

  const place = (
    name: string,
    content: string,
    { encoding = 'latin1', modifiedAt = new Date() }: Placing = {},
  ) => {
    remote.set(name, { content: Buffer.from(content, encoding), modifiedAt })
  }

  for (const [name, content] of Object.entries(files)) {
    place(name, content)
  }

  return { channelId, place, remaining: () => [...remote.keys()].toSorted() }
}

const storedOn = (channelId: string) =>
  connection.db.select().from(documents).where(eq(documents.channelId, channelId))

const received = (channelId: string, count: number) =>
  vi.waitFor(async () => {
    expect(await storedOn(channelId)).toHaveLength(count)
  }, wait)

const removed = (box: { remaining: () => string[] }) =>
  vi.waitFor(() => {
    expect(box.remaining()).toEqual([])
  }, wait)

describe('the polling of inbound SFTP Channels', () => {
  it('receives an Interchange of three Messages in ISO 8859-1 as three Runs and removes its file', async () => {
    const orders = await addOrdersFlow(connection.db, workspace, { url: 'http://erp.invalid/' })
    const box = await outbox({ 'orders.edi': threeOrders }, { flowId: orders.flowId })
    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    const [document] = await storedOn(box.channelId)

    expect(document).toMatchObject({ fileName: 'orders.edi', content: threeOrders })
    expect(
      (
        await connection.db
          .select({ flowId: runs.flowId, messageIndex: runs.messageIndex })
          .from(runs)
          .where(eq(runs.documentId, document?.id ?? ''))
      ).toSorted((a, b) => (a.messageIndex ?? 0) - (b.messageIndex ?? 0)),
    ).toEqual([1, 2, 3].map((messageIndex) => ({ flowId: orders.flowId, messageIndex })))
  })

  it('reads a file in UTF-8 as UTF-8', async () => {
    const box = await outbox()
    const utf8 = "CTA+OC+Claus Früh'"

    box.place('utf8.edi', utf8, { encoding: 'utf8' })

    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await received(box.channelId, 1)

    expect(await storedOn(box.channelId)).toMatchObject([{ fileName: 'utf8.edi', content: utf8 }])
  })

  it('reads an Interchange in UNOW as UTF-8, whatever the bytes of another encoding would be', async () => {
    const box = await outbox()
    const utf8Orders = ordersInterchange.replace('UNOC', 'UNOW')

    box.place('orders.edi', utf8Orders, { encoding: 'utf8' })

    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await received(box.channelId, 1)

    expect(await storedOn(box.channelId)).toMatchObject([{ content: utf8Orders, bytes: null }])
  })

  const processedRunsOn = async (channelId: string) => {
    const found = await connection.db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(documents, eq(documents.id, runs.documentId))
      .where(eq(documents.channelId, channelId))

    for (const { id } of found) {
      await Effect.runPromise(
        processRun({ workspaceId: workspace.id, runId: id }).pipe(
          pipelineServices(connection.db, inMemoryRunQueue()),
        ),
      )
    }

    return Promise.all(found.map(({ id }) => readRun(connection.db, id)))
  }

  it('keeps the bytes of an Interchange not valid in the character set its UNB names, and fails its Run at parse at the first invalid byte', async () => {
    const orders = await addOrdersFlow(connection.db, workspace, { url: 'http://erp.invalid/' })
    const box = await outbox({}, { flowId: orders.flowId })
    const latin1Bytes = ordersInterchange.replace('UNOC', 'UNOW')

    box.place('orders.edi', latin1Bytes)

    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    const [run] = await processedRunsOn(box.channelId)

    expect(run?.document).toMatchObject({
      content: null,
      bytes: Buffer.from(latin1Bytes, 'latin1'),
    })
    // UNB to NAD take 205 bytes, CTA+OC+Claus Fr the rest before the ü.
    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'parse',
      error: {
        code: 'invalid-byte-sequence',
        message:
          'Byte 206 (0xFC) is not valid in UNOW (UTF-8), at segment 7, element 2, component 1',
        position: { segment: 7, tag: 'CTA', element: 2, component: 1 },
      },
    })
  })

  it('keeps the bytes of a Document not valid UTF-8, and fails its Run where its Document Structure reads it', async () => {
    const box = await outbox({ 'invoice.json': goldenInvoice }, { flowId: workspace.flowId })
    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    const [run] = await processedRunsOn(box.channelId)

    expect(run?.document).toMatchObject({
      content: null,
      bytes: Buffer.from(goldenInvoice, 'latin1'),
    })
    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      error: { code: 'invalid-byte-sequence', message: 'Byte 574 (0xFC) is not valid UTF-8' },
    })
  })

  it('takes the content hash of a file over its bytes', async () => {
    const box = await outbox({ 'orders.edi': threeOrders })
    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    expect(await storedOn(box.channelId)).toMatchObject([
      {
        contentHash: createHash('sha256').update(Buffer.from(threeOrders, 'latin1')).digest('hex'),
      },
    ])
  })

  it('removes a file whose Document is stored but rejected at receipt', async () => {
    const box = await outbox({ 'no-flow.edi': threeOrders })
    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('holds back a file, however old, until the next poll finds its size and modification time unchanged', async () => {
    const box = await outbox()

    box.place('arriving.edi', threeOrders, { modifiedAt: new Date(Date.now() - 7_200_000) })

    const polling = await startPolling()

    await polling.pollAgain(box.channelId)
    await removed(box)

    expect(polling.operations(box.channelId)).toEqual(['list', 'list', 'read', 'remove'])
    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('holds back a file whose size or modification time changed since the previous poll', async () => {
    const box = await outbox()
    const modifiedAt = new Date()

    box.place('growing.edi', ordersMessage.slice(0, 3).join('\n'), { modifiedAt })

    const polling = await startPolling()

    await polling.polled(box.channelId, 1)
    box.place('growing.edi', ordersMessage.join('\n'), { modifiedAt })
    await polling.minutesPass(1)
    await polling.polled(box.channelId, 2)
    box.place('growing.edi', ordersMessage.join('\n'), { modifiedAt: new Date(Date.now() + 1000) })
    await polling.minutesPass(1)
    await polling.pollAgain(box.channelId, 3)
    await removed(box)

    expect(polling.operations(box.channelId)).toEqual([
      'list',
      'list',
      'list',
      'list',
      'read',
      'remove',
    ])
  })

  it('polls each Channel at its own interval', async () => {
    const everyMinute = await outbox({}, { pollingIntervalMinutes: 1 })
    const everyTwo = await outbox({}, { pollingIntervalMinutes: 2 })

    const polling = await startPolling()

    await polling.polled(everyMinute.channelId, 1)
    await polling.polled(everyTwo.channelId, 1)
    await polling.minutesPass(1)
    await polling.polled(everyMinute.channelId, 2)

    expect(polling.lists(everyTwo.channelId)).toBe(1)

    await polling.minutesPass(1)
    await polling.polled(everyMinute.channelId, 3)
    await polling.polled(everyTwo.channelId, 2)
  })

  it('polls a Channel created or changed while polling runs without a restart', async () => {
    const changed = await outbox({}, { pollingIntervalMinutes: 5 })

    const polling = await startPolling()

    await polling.polled(changed.channelId, 1)

    const created = await outbox()

    await connection.db
      .update(channels)
      .set({ pollingIntervalMinutes: 1 })
      .where(eq(channels.id, changed.channelId))
    await polling.minutesPass(1)

    await polling.polled(changed.channelId, 2)
    await polling.polled(created.channelId, 1)
  })

  it('never polls a seeded Channel', async () => {
    const seeded = await outbox({ 'orders.edi': threeOrders })
    const other = await outbox()

    await markSeeded(connection.db, seeded.channelId)

    const polling = await startPolling()

    await polling.pollAgain(other.channelId)
    await polling.polled(other.channelId, 2)

    expect(polling.lists(seeded.channelId)).toBe(0)
    expect(seeded.remaining()).toEqual(['orders.edi'])
  })

  const overSftp = (
    login: { host: string; port: number },
    options: Parameters<typeof receiveOverSftp>[3] = {},
  ) => receiveOverSftp(connection.db, workspace, { ...login, ...sftpLogin }, options)

  const unreachable = () => overSftp({ host: '127.0.0.1', port: 1 })

  it('receives the files of the other Channels when one has a bad credential or an unreachable host', async () => {
    const badCredentialId = await overSftp(
      { host: 'sftp.invalid', port: 22 },
      { secrets: secretBox(randomBytes(secretKeyBytes)) },
    )

    const unreachableId = await unreachable()
    const healthy = await outbox({ 'orders.edi': threeOrders })

    const polling = await startPolling()

    await polling.pollAgain(healthy.channelId)
    await removed(healthy)
    // A failed poll ends after it stores its poll problem, so the clock moves on until it ran again.
    await polling.polledOnceMore(badCredentialId, 2)
    await polling.polledOnceMore(unreachableId, 2)
  })

  it('refuses a server whose host key does not match and logs the mismatch with the Channel', async () => {
    const { host, port, username, password } = sftp
    const logs: PollLog[] = []

    await sftp.exec(
      `install -d -m 777 ${sftp.home}/impostor && echo '{}' > ${sftp.home}/impostor/invoice.json`,
    )

    const impostorId = await receiveOverSftp(connection.db, workspace, {
      host,
      port,
      username,
      password,
      remotePath: '/impostor',
      hostKeyFingerprint: mismatchingHostKeyFingerprint,
    })

    const polling = await startPolling(download, logs)

    await vi.waitFor(
      () => {
        const log = logs.find(
          ({ message }) =>
            Array.isArray(message) &&
            message.includes(`Inbound Channel ${impostorId} not polled: hostKeyMismatch`),
        )

        expect(log && Cause.findErrorOption(log.cause)).toEqual(
          Option.some(new DownloadFailed({ reason: 'hostKeyMismatch' })),
        )
      },
      { timeout: 2000, interval: 10 },
    )
    expect(polling.operations(impostorId).filter((operation) => operation !== 'list')).toEqual([])
    expect(
      await connection.db.select().from(documents).where(eq(documents.channelId, impostorId)),
    ).toEqual([])
    expect(defectReportsIn(workspace.id)).toEqual([])
  })

  it('polls a Channel again at its next interval after its poll failed', async () => {
    const unreachableId = await unreachable()

    const polling = await startPolling()

    await polling.polled(unreachableId, 1)
    await polling.minutesPass(1)
    await polling.polled(unreachableId, 2)
  })

  it('removes a stored file at the next poll when its removal failed, without receiving it again', async () => {
    const box = await outbox({ 'orders.edi': threeOrders })
    let failures = 1

    const polling = await startPolling({
      ...download,
      remove: (channel, name) =>
        Effect.suspend(() => {
          if (failures > 0) {
            failures -= 1

            return Effect.fail(new DownloadFailed({ reason: 'timedOut' }))
          }

          return download.remove(channel, name)
        }),
    })

    await polling.pollAgain(box.channelId)
    await vi.waitFor(() => {
      expect(polling.operations(box.channelId)).toContain('remove')
    }, wait)
    await polling.polledOnceMore(box.channelId, 3)
    await removed(box)

    expect(polling.operations(box.channelId).filter((operation) => operation !== 'list')).toEqual([
      'read',
      'remove',
      'remove',
    ])
    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('records a stored file received again after a restart as a Duplicate', async () => {
    const orders = await addOrdersFlow(connection.db, workspace, { url: 'http://erp.invalid/' })
    const box = await outbox({ 'orders.edi': threeOrders }, { flowId: orders.flowId })

    const beforeRestart = await startPolling({
      ...download,
      remove: () => Effect.fail(new DownloadFailed({ reason: 'timedOut' })),
    })

    await beforeRestart.pollAgain(box.channelId)
    await received(box.channelId, 1)
    await stopPolling?.()

    const afterRestart = await startPolling()

    await afterRestart.pollAgain(box.channelId)
    await removed(box)

    const [first, second] = (await storedOn(box.channelId)).toSorted(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
    )

    const runsOf = (documentId: string) =>
      connection.db
        .select({ id: runs.id, status: runs.status, duplicateOfRunId: runs.duplicateOfRunId })
        .from(runs)
        .where(eq(runs.documentId, documentId))
        .orderBy(runs.messageIndex)

    const originals = await runsOf(first?.id ?? '')
    const anyId: unknown = expect.any(String)

    expect(originals.map(({ status }) => status)).toEqual(['received', 'received', 'received'])
    expect(await runsOf(second?.id ?? '')).toEqual(
      originals.map(({ id }) => ({
        id: anyId,
        status: 'duplicate',
        duplicateOfRunId: id,
      })),
    )
  })

  it('does not receive a file twice when a poll is still running at the next interval', async () => {
    const box = await outbox({ 'slow.edi': threeOrders })
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    let reads = 0

    const polling = await startPolling({
      ...download,
      read: (channel, name) =>
        Effect.promise(async () => {
          reads += 1
          await released
        }).pipe(Effect.andThen(download.read(channel, name))),
    })

    await polling.pollAgain(box.channelId)
    await vi.waitFor(() => {
      expect(reads).toBe(1)
    }, wait)
    await polling.minutesPass(1)
    await polling.minutesPass(1)
    release()
    await removed(box)
    await polling.polledOnceMore(box.channelId, 3)

    expect(reads).toBe(1)
    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('records a stored file without an Interchange received again after a restart as a Duplicate', async () => {
    const box = await outbox({ 'invoice.json': goldenInvoice }, { flowId: workspace.flowId })

    const beforeRestart = await startPolling({
      ...download,
      remove: () => Effect.fail(new DownloadFailed({ reason: 'timedOut' })),
    })

    await beforeRestart.pollAgain(box.channelId)
    await received(box.channelId, 1)
    await stopPolling?.()

    const afterRestart = await startPolling()

    await afterRestart.pollAgain(box.channelId)
    await removed(box)

    const stored = await connection.db
      .select({ status: runs.status, duplicateOfRunId: runs.duplicateOfRunId, id: runs.id })
      .from(runs)
      .innerJoin(documents, eq(documents.id, runs.documentId))
      .where(eq(documents.channelId, box.channelId))
      .orderBy(documents.receivedAt)

    const anyId: unknown = expect.any(String)

    expect(stored).toEqual([
      { status: 'received', duplicateOfRunId: null, id: anyId },
      { status: 'duplicate', duplicateOfRunId: stored[0]?.id, id: anyId },
    ])
  })

  const pollProblemOf = async (channelId: string) => {
    const [stored] = await connection.db
      .select({
        reason: channels.pollProblemReason,
        since: channels.pollProblemSince,
        // Postgres gives a row a new xmin on every update, so an unchanged one means no write.
        version: sql<string>`xmin::text`,
      })
      .from(channels)
      .where(eq(channels.id, channelId))

    return stored
  }

  const pollProblemStored = (channelId: string, expected: { reason: string; since: Date }) =>
    vi.waitFor(
      async () => {
        expect(await pollProblemOf(channelId)).toMatchObject(expected)
      },
      { timeout: 2000, interval: 10 },
    )

  const impostor = async () => {
    const remotePath = `/impostor-${randomBytes(4).toString('hex')}`

    await sftp.exec(`install -d -m 777 ${sftp.home}${remotePath}`)

    return receiveOverSftp(connection.db, workspace, {
      ...sftpLogin,
      host: sftp.host,
      port: sftp.port,
      remotePath,
      hostKeyFingerprint: mismatchingHostKeyFingerprint,
    })
  }

  it('stores the reason of a failed poll and the time of its first failure on the Channel', async () => {
    const impostorId = await impostor()
    const polling = await startPolling()

    await pollProblemStored(impostorId, { reason: 'hostKeyMismatch', since: polling.startedAt })
  })

  it('writes nothing while a Channel fails again with the same reason', async () => {
    const impostorId = await impostor()
    const polling = await startPolling()

    await pollProblemStored(impostorId, { reason: 'hostKeyMismatch', since: polling.startedAt })

    const first = await pollProblemOf(impostorId)

    await polling.minutesPass(1)
    await polling.polled(impostorId, 2)

    expect(await pollProblemOf(impostorId)).toEqual(first)
  })

  it('clears the poll problem at the next successful poll', async () => {
    const impostorId = await impostor()
    const polling = await startPolling()

    await pollProblemStored(impostorId, { reason: 'hostKeyMismatch', since: polling.startedAt })
    await connection.db
      .update(channels)
      .set({ hostKeyFingerprint: sftp.hostKeyFingerprint })
      .where(eq(channels.id, impostorId))
    await polling.minutesPass(1)

    await vi.waitFor(
      async () => {
        expect(await pollProblemOf(impostorId)).toMatchObject({ reason: null, since: null })
      },
      { timeout: 2000, interval: 10 },
    )
  })

  const failingWith = (channelId: string, failure: () => Effect.Effect<never, DownloadFailed>) => ({
    ...download,
    list: (channel: Parameters<DownloadService['list']>[0]) =>
      channel.id === channelId ? failure() : download.list(channel),
  })

  it('rewrites the reason and the time of the first failure when the reason changes', async () => {
    const box = await outbox()
    let reason: DownloadFailed['reason'] = 'timedOut'

    const polling = await startPolling(
      failingWith(box.channelId, () => Effect.fail(new DownloadFailed({ reason }))),
    )

    await pollProblemStored(box.channelId, { reason: 'timedOut', since: polling.startedAt })
    reason = 'loginRejected'
    await polling.minutesPass(1)

    await pollProblemStored(box.channelId, {
      reason: 'loginRejected',
      since: new Date(polling.startedAt.getTime() + 60_000),
    })
  })

  it('writes nothing when a Channel without a poll problem is polled', async () => {
    const box = await outbox()
    const polling = await startPolling()
    const before = await pollProblemOf(box.channelId)

    await polling.pollAgain(box.channelId)
    await polling.polled(box.channelId, 2)

    expect(await pollProblemOf(box.channelId)).toEqual(before)
  })

  it('stores no poll problem for a defect', async () => {
    const box = await outbox()
    const logs: PollLog[] = []

    const polling = await startPolling(
      failingWith(box.channelId, () => Effect.die(new Error('listing broke'))),
      logs,
    )

    await polling.polled(box.channelId, 1)
    await vi.waitFor(() => {
      expect(
        logs.some(
          ({ message }) =>
            Array.isArray(message) &&
            message.includes(`Inbound Channel ${box.channelId} not polled`),
        ),
      ).toBe(true)
    }, wait)

    expect(await pollProblemOf(box.channelId)).toMatchObject({ reason: null, since: null })
  })

  it('reports a defect of a poll to error monitoring with its Channel', async () => {
    const box = await outbox()
    const defects = recordingDefectReporter()

    await startPolling(
      failingWith(box.channelId, () => Effect.die(new Error('listing broke'))),
      [],
      { defects },
    )

    await vi.waitFor(() => {
      expect(defects.reported).toMatchObject([
        {
          workspaceId: workspace.id,
          runId: null,
          tradingPartnerId: null,
          channelId: box.channelId,
          code: 'channelDefect',
          cause: { name: 'Error' },
        },
      ])
    }, wait)
  })

  it('reports a repeating defect of a Channel once until a poll of that Channel succeeds', async () => {
    const box = await outbox()
    const defects = recordingDefectReporter()
    let broken = true

    const polling = await startPolling(
      {
        ...download,
        list: (channel) =>
          broken ? Effect.die(new Error('listing broke')) : download.list(channel),
      },
      [],
      { defects },
    )

    const reportsAfterPoll = async (times: number, reports: number) => {
      await polling.polled(box.channelId, times)
      await vi.waitFor(() => {
        expect(defects.reported).toHaveLength(reports)
      }, wait)
    }

    await reportsAfterPoll(1, 1)
    await polling.minutesPass(1)
    await reportsAfterPoll(2, 1)
    broken = false
    await polling.minutesPass(1)
    await reportsAfterPoll(3, 1)
    broken = true
    await polling.minutesPass(1)
    await reportsAfterPoll(4, 2)
  })

  it('reports a defect while receiving a file to error monitoring with its Channel', async () => {
    const box = await outbox({ 'orders.edi': threeOrders })
    const defects = recordingDefectReporter()

    const polling = await startPolling(
      { ...download, read: () => Effect.die(new Error('reading broke')) },
      [],
      { defects },
    )

    await polling.pollAgain(box.channelId)
    await vi.waitFor(() => {
      expect(defects.reported).toMatchObject([
        {
          workspaceId: workspace.id,
          runId: null,
          tradingPartnerId: null,
          channelId: box.channelId,
          code: 'channelDefect',
          cause: { name: 'Error' },
        },
      ])
    }, wait)
  })

  it('reports a defect while removing a stored file to error monitoring with its Channel', async () => {
    const box = await outbox({ 'orders.edi': threeOrders })
    const defects = recordingDefectReporter()
    let removals = 0

    const polling = await startPolling(
      {
        ...download,
        remove: () =>
          Effect.suspend(() => {
            removals += 1

            return removals === 1
              ? Effect.fail(new DownloadFailed({ reason: 'timedOut' }))
              : Effect.die(new Error('removing broke'))
          }),
      },
      [],
      { defects },
    )

    await polling.pollAgain(box.channelId)
    await polling.polledOnceMore(box.channelId, 3)
    await vi.waitFor(() => {
      expect(removals).toBeGreaterThanOrEqual(2)
      expect(defects.reported).not.toEqual([])
    }, wait)

    // Each later poll tries the removal again, and the repeating defect is reported once.
    expect(defects.reported).toMatchObject([
      { workspaceId: workspace.id, runId: null, channelId: box.channelId, code: 'channelDefect' },
    ])
  })

  it('reports no failed poll to error monitoring', async () => {
    const box = await outbox()
    const defects = recordingDefectReporter()

    const polling = await startPolling(
      failingWith(box.channelId, () => Effect.fail(new DownloadFailed({ reason: 'timedOut' }))),
      [],
      { defects },
    )

    await pollProblemStored(box.channelId, { reason: 'timedOut', since: polling.startedAt })

    expect(defects.reported).toEqual([])
  })

  it('reports a poll problem it could not store as a defect of its Channel', async () => {
    const box = await outbox()
    const defects = recordingDefectReporter()

    await startPolling(
      failingWith(box.channelId, () => Effect.fail(new DownloadFailed({ reason: 'timedOut' }))),
      [],
      { db: breakingDatabase(connection.db, 'update'), defects },
    )

    await vi.waitFor(() => {
      expect(defects.reported).toMatchObject([
        { workspaceId: workspace.id, runId: null, channelId: box.channelId, code: 'channelDefect' },
      ])
    }, wait)
  })
})

describe('the polling loop', () => {
  it('reports a defect that stops a check of the Channels to error monitoring', async () => {
    const defects = recordingDefectReporter()

    await startPolling(download, [], { db: breakingDatabase(connection.db, 'select'), defects })

    await vi.waitFor(() => {
      expect(defects.reported).toMatchObject([
        {
          workspaceId: null,
          runId: null,
          tradingPartnerId: null,
          channelId: null,
          code: 'pollingDefect',
          cause: { name: 'Error' },
        },
      ])
    }, wait)
  })

  it('reports a repeating defect of the loop once until a check of the Channels succeeds', async () => {
    const defects = recordingDefectReporter()
    let broken = true
    let checks = 0

    const polling = await startPolling(download, [], {
      db: breakingDatabase(connection.db, 'select', () => {
        checks += 1

        return broken
      }),
      defects,
    })

    // The loop sleeps after each check, so the clock moves on only once a check has ended.
    const reportsAfterCheck = async (times: number, reports: number) => {
      await vi.waitFor(() => {
        expect(checks).toBe(times)
        expect(polling.sleeps()).toBe(times)
        expect(defects.reported).toHaveLength(reports)
      }, wait)
    }

    await reportsAfterCheck(1, 1)
    await polling.minutesPass(1)
    await reportsAfterCheck(2, 1)
    broken = false
    await polling.minutesPass(1)
    await reportsAfterCheck(3, 1)
    broken = true
    await polling.minutesPass(1)
    await reportsAfterCheck(4, 2)
  })
})
