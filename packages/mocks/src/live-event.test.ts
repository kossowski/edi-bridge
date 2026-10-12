import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  liveEventsEndpoint,
  homeEndpoint,
  homeSchema,
  parseLiveEvent,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  toPath,
  toSearchParams,
} from '@edi-bridge/contracts'

import { homeHandler } from './home'
import { createHandlers } from './index'
import { liveEventsHandler, type LiveEventsOptions } from './live-event'
import { createRuns, runsHandler, seedRuns } from './run'
import { createRunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

let streams: AbortController

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

// A busy CI runner takes seconds to build the 12,000 seeded Runs. Built once here, they stay out
// of the time limit of the first test that reads them.
beforeAll(() => {
  seedRuns()
})

beforeEach(() => {
  streams = new AbortController()
})

afterEach(() => {
  streams.abort()
  server.resetHandlers()
})

afterAll(() => server.close())

function live(options: LiveEventsOptions = {}) {
  return liveEventsHandler(apiUrl, { intervalMs: 5, signal: streams.signal, ...options })
}

async function openStream() {
  const response = await fetch(`${apiUrl}${liveEventsEndpoint.path}`, {
    headers: { accept: 'text/event-stream' },
  })

  return { response, reader: response.body!.getReader() }
}

type Frame = { id: string | undefined; data: string }

async function readFrames(
  { reader }: { reader: ReadableStreamDefaultReader<Uint8Array> },
  count: number,
  timeoutMs = 1000,
) {
  const decoder = new TextDecoder()
  const frames: Frame[] = []
  const deadline = Date.now() + timeoutMs
  let buffer = ''
  let ended = false

  while (frames.length < count) {
    const result = await Promise.race([
      reader.read().catch(() => ({ done: true as const, value: undefined })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
    ])

    if (result === null) {
      break
    }

    if (result.done) {
      ended = true
      break
    }

    buffer += decoder.decode(result.value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const lines = block.split('\n')
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5))

      if (data.length > 0) {
        frames.push({
          id: lines.find((line) => line.startsWith('id:'))?.slice(3),
          data: data.join('\n'),
        })
      }
    }
  }

  return { frames: frames.slice(0, count), ended }
}

function eventsOf(frames: Frame[]) {
  return frames.flatMap(({ data }) => parseLiveEvent(data) ?? [])
}

async function listRuns() {
  const response = await fetch(`${apiUrl}${runsEndpoint.path}?${toSearchParams({ pageSize: 100 })}`)

  return runListSchema.parse(await response.json())
}

describe('GET /events', () => {
  it('streams newly received Runs and adds them to the Runs list', async () => {
    const runs = createRunStore(createRuns({ count: 20 }))
    server.use(live({ runs }), runsHandler(apiUrl, runs))

    const stream = await openStream()

    expect(stream.response.headers.get('content-type')).toBe('text/event-stream')

    const events = eventsOf((await readFrames(stream, 3)).frames)

    expect(events).toHaveLength(3)

    const { runs: listed } = await listRuns()

    for (const event of events) {
      expect(event.type).toBe('run.changed')
      expect(listed.map(({ id }) => id)).toContain(event.run.id)
    }
  })

  it('finishes each received Run on a later tick, so Home counts it', async () => {
    const runs = createRunStore([])
    server.use(
      live({ runs }),
      homeHandler(apiUrl, {
        runs,
        tradingPartners: seedTradingPartners,
        overdueAcknowledgements: [],
      }),
    )

    const events = eventsOf((await readFrames(await openStream(), 5)).frames)
    streams.abort()
    const [first] = events
    const finished = events.filter(({ run }) => run.status !== 'processing')

    expect(first?.run.status).toBe('processing')
    expect(finished.map(({ run }) => run.id)).toContain(first?.run.id)
    expect(finished.every(({ run }) => ['delivered', 'failed'].includes(run.status))).toBe(true)

    const response = await fetch(`${apiUrl}${homeEndpoint.path}?window=24h`)
    const { throughput } = homeSchema.parse(await response.json())
    const counted = throughput.reduce((sum, { delivered, failed }) => sum + delivered + failed, 0)

    expect(counted).toBe(runs.all().filter(({ status }) => status !== 'processing').length)
    expect(counted).toBeGreaterThanOrEqual(finished.length)
  })

  it('sends events without ids, so a reconnecting client refetches instead of resuming', async () => {
    server.use(live({ runs: createRunStore([]) }))

    const { frames } = await readFrames(await openStream(), 2)

    expect(frames).toHaveLength(2)
    expect(frames.map(({ id }) => id)).toEqual([undefined, undefined])
  })

  it('ends every stream and stops changing Runs once stopped', async () => {
    const runs = createRunStore([])
    server.use(live({ runs }))

    const stream = await openStream()
    await readFrames(stream, 1)
    streams.abort()
    const count = runs.all().length
    const { ended } = await readFrames(stream, 100, 200)

    expect(ended).toBe(true)
    expect(runs.all()).toHaveLength(count)
  })
})

describe('GET /events states', () => {
  it('keeps a quiet stream open without events', async () => {
    const runs = createRunStore([])
    server.use(live({ runs, mode: 'quiet' }))

    const stream = await openStream()
    const { frames, ended } = await readFrames(stream, 1, 100)

    expect(stream.response.status).toBe(200)
    expect(frames).toEqual([])
    expect(ended).toBe(false)
    expect(runs.all()).toEqual([])
  })

  it('answers that the service is unavailable', async () => {
    server.use(live({ mode: 'unavailable' }))

    const { response } = await openStream()

    expect(response.status).toBe(503)
  })

  it('drops the connection after a few events, so a client has to reconnect', async () => {
    server.use(live({ runs: createRunStore([]), mode: 'dropping', dropAfter: 3 }))

    const { frames, ended } = await readFrames(await openStream(), 10)

    expect(ended).toBe(true)
    expect(frames.length).toBeGreaterThanOrEqual(3)
    expect(frames.length).toBeLessThan(10)
  })

  it('drops the first connection and leaves every reconnect unanswered, so a client keeps reconnecting', async () => {
    server.use(live({ runs: createRunStore([]), mode: 'stalling', dropAfter: 1 }))

    const { ended } = await readFrames(await openStream(), 10)

    expect(ended).toBe(true)
    await expect(
      fetch(`${apiUrl}${liveEventsEndpoint.path}`, { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow()
  })
})

describe('createHandlers live events', () => {
  it('keeps the stream quiet unless asked for live events', async () => {
    server.use(...createHandlers(apiUrl))

    const stream = await openStream()
    const { frames } = await readFrames(stream, 1, 100)
    void stream.reader.cancel()

    expect(stream.response.status).toBe(200)
    expect(frames).toEqual([])
  })

  it('shows a streamed Run in its current status', async () => {
    server.use(
      ...createHandlers(apiUrl, {
        liveEvents: { mode: 'live', intervalMs: 5, signal: streams.signal },
      }),
    )

    const events = eventsOf((await readFrames(await openStream(), 4)).frames)
    streams.abort()
    const latest = new Map(events.map(({ run }) => [run.id, run]))

    for (const run of latest.values()) {
      const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id: run.id })}`)

      expect(runDetailSchema.parse(await response.json())).toMatchObject({
        id: run.id,
        status: run.status,
      })
    }
  })
})
