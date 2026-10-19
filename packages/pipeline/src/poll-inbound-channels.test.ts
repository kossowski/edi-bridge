import { eq } from 'drizzle-orm'
import { Clock, Duration, Effect, Exit, Fiber, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DownloadFailed,
  secretBox,
  secretKeyBytes,
  sftpChannelDownload,
} from '@edi-bridge/channels'
import { startTestSftpServer, type TestSftpServer } from '@edi-bridge/channels/testing'
import { channels, connect, type Connection, documents, runs, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { Download, type DownloadService, pollInboundChannels } from './index'
import {
  addOrdersFlow,
  golden,
  inMemoryRunQueue,
  type InvoiceWorkspace,
  pipelineServices,
  receiveOverSftp,
  seedInvoiceWorkspace,
  testSecrets,
} from './testing'

let testDatabase: TestDatabase

let sftp: TestSftpServer

let connection: Connection

let workspace: InvoiceWorkspace

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

type Call = { operation: 'list' | 'read' | 'remove'; channelId: string; name?: string }

// Records each finished call, so a test knows a poll got that far.
const recorded = (download: DownloadService) => {
  const calls: Call[] = []

  const noting = (call: Call) => Effect.ensuring(Effect.sync(() => calls.push(call)))

  const service: DownloadService = {
    list: (channel) =>
      download.list(channel).pipe(noting({ operation: 'list', channelId: channel.id })),
    read: (channel, name) =>
      download.read(channel, name).pipe(noting({ operation: 'read', channelId: channel.id, name })),
    remove: (channel, name) =>
      download
        .remove(channel, name)
        .pipe(noting({ operation: 'remove', channelId: channel.id, name })),
  }

  return { calls, service }
}

const sftpDownload = () => sftpChannelDownload({ secrets: testSecrets, timeoutMs: 5000 })

let stopPolling: (() => Promise<void>) | undefined

// The poller sees every inbound SFTP Channel, so each test brings its own Workspace.
beforeEach(async () => {
  workspace = await seedInvoiceWorkspace(connection.db, 'Nordwind Foods')
})

afterEach(async () => {
  await stopPolling?.()
  stopPolling = undefined
  await connection.db.delete(workspaces).where(eq(workspaces.id, workspace.id))
})

const startPolling = async (download: DownloadService = sftpDownload()) => {
  const recording = recorded(download)
  const scope = await Effect.runPromise(Scope.make())
  const clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(scope)))

  await Effect.runPromise(clock.setTime(Date.now()))

  const polling = Effect.runFork(
    pollInboundChannels.pipe(
      pipelineServices(connection.db, inMemoryRunQueue()),
      Effect.provideService(Download, recording.service),
      Effect.provideService(Clock.Clock, clock),
    ),
  )

  stopPolling = async () => {
    await Effect.runPromise(Fiber.interrupt(polling))
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }

  const lists = (channelId: string) =>
    recording.calls.filter((call) => call.operation === 'list' && call.channelId === channelId)
      .length

  return {
    calls: recording.calls,
    lists,
    minutesPass: async (minutes: number) => {
      await Effect.runPromise(clock.adjust(Duration.minutes(minutes)))
    },
    polled: (channelId: string, times: number) =>
      vi.waitFor(
        () => {
          expect(lists(channelId)).toBe(times)
        },
        { timeout: 2000, interval: 20 },
      ),
  }
}

let outboxes = 0

type Placing = { old?: boolean; encoding?: BufferEncoding }

// Two hours ago is longer than any polling interval in these tests.
const writing = (path: string, content: string, { old = true, encoding = 'latin1' }: Placing) =>
  [
    `echo ${Buffer.from(content, encoding).toString('base64')} | base64 -d > ${path}`,
    ...(old ? [`touch -d @${String(Math.floor(Date.now() / 1000) - 7200)} ${path}`] : []),
  ].join(' && ')

const outbox = async (
  files: Record<string, string> = {},
  options: Parameters<typeof receiveOverSftp>[3] = {},
) => {
  outboxes += 1
  const remotePath = `/upload/outbox-${String(outboxes)}`
  const directory = `${sftp.home}${remotePath}`

  await sftp.exec(
    [
      `install -d -m 777 ${directory}`,
      ...Object.entries(files).map(([name, content]) =>
        writing(`${directory}/${name}`, content, {}),
      ),
    ].join(' && '),
  )

  const channelId = await receiveOverSftp(
    connection.db,
    workspace,
    {
      host: sftp.host,
      port: sftp.port,
      username: sftp.username,
      password: sftp.password,
      remotePath,
    },
    options,
  )

  const place = async (name: string, content: string, placing: Placing = {}) => {
    await sftp.exec(writing(`${directory}/${name}`, content, placing))
  }

  const remaining = async () =>
    (await sftp.exec(`ls -1 ${directory}`)).output.split('\n').filter(Boolean).toSorted()

  return { channelId, place, remaining }
}

const storedOn = (channelId: string) =>
  connection.db.select().from(documents).where(eq(documents.channelId, channelId))

const received = (channelId: string, count: number) =>
  vi.waitFor(
    async () => {
      expect(await storedOn(channelId)).toHaveLength(count)
    },
    { timeout: 3000, interval: 50 },
  )

const removed = (box: { remaining: () => Promise<string[]> }, left: string[] = []) =>
  vi.waitFor(
    async () => {
      expect(await box.remaining()).toEqual(left)
    },
    { timeout: 3000, interval: 50 },
  )

describe('the polling of inbound SFTP Channels', () => {
  it('receives an Interchange of three Messages in ISO 8859-1 as three Runs and removes its file', async () => {
    const orders = await addOrdersFlow(connection.db, workspace, { url: 'http://erp.invalid/' })
    const box = await outbox({ 'orders.edi': threeOrders }, { flowId: orders.flowId })

    await startPolling()
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

    await box.place('utf8.edi', utf8, { encoding: 'utf8' })
    await startPolling()
    await received(box.channelId, 1)

    expect(await storedOn(box.channelId)).toMatchObject([{ fileName: 'utf8.edi', content: utf8 }])
  })

  it('removes a file whose Document is stored but rejected at receipt', async () => {
    const box = await outbox({ 'no-flow.edi': threeOrders })

    await startPolling()
    await removed(box)

    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('holds back a new file until the next poll finds its size and modification time unchanged', async () => {
    const box = await outbox()

    await box.place('arriving.edi', threeOrders, { old: false })

    const polling = await startPolling()

    await polling.polled(box.channelId, 1)
    expect(await storedOn(box.channelId)).toHaveLength(0)

    await polling.minutesPass(1)
    await removed(box)

    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('holds back a file that grew since the previous poll', async () => {
    const box = await outbox()

    await box.place('growing.edi', ordersMessage.slice(0, 3).join('\n'), { old: false })

    const polling = await startPolling()

    await polling.polled(box.channelId, 1)
    await box.place('growing.edi', ordersMessage.join('\n'), { old: false })
    await polling.minutesPass(1)
    await polling.polled(box.channelId, 2)

    expect(await storedOn(box.channelId)).toHaveLength(0)
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

  const unreachable = () =>
    receiveOverSftp(connection.db, workspace, {
      host: '127.0.0.1',
      port: 1,
      username: sftp.username,
      password: sftp.password,
      remotePath: '/upload',
    })

  it('receives the files of the other Channels when one has a bad credential or an unreachable host', async () => {
    const badCredential = await outbox(
      { 'orders.edi': threeOrders },
      { secrets: secretBox(randomBytes(secretKeyBytes)) },
    )

    const unreachableId = await unreachable()
    const healthy = await outbox({ 'orders.edi': threeOrders })

    const polling = await startPolling()

    await removed(healthy)
    await polling.polled(unreachableId, 1)

    expect(await badCredential.remaining()).toEqual(['orders.edi'])
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
    const download = sftpDownload()
    let failures = 1

    const polling = await startPolling({
      ...download,
      remove: (channel, name) =>
        Effect.suspend(() => {
          if (channel.id === box.channelId && failures > 0) {
            failures -= 1

            return Effect.fail(new DownloadFailed({ reason: 'timedOut' }))
          }

          return download.remove(channel, name)
        }),
    })

    await vi.waitFor(() => {
      expect(polling.calls).toContainEqual({
        operation: 'remove',
        channelId: box.channelId,
        name: 'orders.edi',
      })
    }, 3000)
    await polling.minutesPass(1)
    await removed(box)

    expect(await storedOn(box.channelId)).toHaveLength(1)
  })

  it('does not receive a file twice when a poll is still running at the next interval', async () => {
    const box = await outbox({ 'slow.edi': threeOrders })
    const download = sftpDownload()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    let reads = 0

    const polling = await startPolling({
      ...download,
      read: (channel, name) =>
        channel.id === box.channelId
          ? Effect.promise(async () => {
              reads += 1
              await released
            }).pipe(Effect.andThen(download.read(channel, name)))
          : download.read(channel, name),
    })

    await vi.waitFor(() => {
      expect(reads).toBe(1)
    }, 3000)
    await polling.minutesPass(1)
    await polling.minutesPass(1)
    release()
    await removed(box)
    await polling.minutesPass(1)
    await polling.polled(box.channelId, 2)

    expect(reads).toBe(1)
    expect(await storedOn(box.channelId)).toHaveLength(1)
  })
})
