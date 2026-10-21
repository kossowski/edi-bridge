import { captureException, getClient, type NodeOptions, withScope } from '@sentry/node'
import { Effect, Tracer } from 'effect'
import { openSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { RunTrace } from '@edi-bridge/pipeline'

import { type Monitoring, withMonitoring, startSentry, stopSentry } from './sentry.js'

type Envelope = Parameters<ReturnType<NonNullable<NodeOptions['transport']>>['send']>[0]

const sent: Envelope[] = []

let monitoring: Monitoring

let rejectionHandlers: NodeJS.UnhandledRejectionListener[]

beforeAll(() => {
  const before = process.listeners('unhandledRejection')

  monitoring = startSentry(
    { dsn: 'https://key@sentry.example/1', environment: 'test', tracesSampleRate: 1 },
    () => ({
      send: (envelope) => {
        sent.push(envelope)

        return Promise.resolve({})
      },
      flush: () => Promise.resolve(true),
    }),
  )
  rejectionHandlers = process
    .listeners('unhandledRejection')
    .filter((listener) => !before.includes(listener))
})

afterAll(async () => {
  await stopSentry()
})

const itemsOf = (type: string) =>
  sent.flatMap(([, items]) =>
    items.flatMap(([header, payload]) => (header.type === type ? [payload] : [])),
  )

const eventsOf = (runId: string) =>
  itemsOf('event').filter((event) => JSON.stringify(event).includes(runId))

const spanSchema = z.object({
  name: z.string(),
  span_id: z.string(),
  trace_id: z.string(),
  parent_span_id: z.string().optional(),
  status: z.string(),
  attributes: z.record(z.string(), z.object({ value: z.unknown() })),
})

const spans = () =>
  itemsOf('span').flatMap(
    (payload) => z.object({ items: z.array(spanSchema) }).parse(payload).items,
  )

const runSpanOf = (runId: string) => spans().find((span) => span.attributes.runId?.value === runId)

const runSpan = (runId: string, trace?: RunTrace) =>
  Effect.void.pipe(
    Effect.withSpan('run.processing', {
      attributes: { runId },
      parent: trace && Tracer.externalSpan(trace),
    }),
  )

const secret = 'UNH+1+INVOIC:D:96A:UN password=hunter2'

describe('a defect reported to Sentry', () => {
  it('arrives as an event tagged with the Workspace, Run, Trading Partner and Channel', async () => {
    const defect = new TypeError(secret)

    await Effect.runPromise(
      monitoring.defectReporter.report({
        workspaceId: 'workspace-1',
        runId: 'run-tagged',
        tradingPartnerId: 'partner-1',
        channelId: 'channel-1',
        code: 'channelDefect',
        cause: { name: defect.name, frames: ['at deliver (/app/dist/main.js:10:5)'] },
      }),
    )

    await vi.waitFor(() => {
      expect(eventsOf('run-tagged')).toHaveLength(1)
    })
    expect(eventsOf('run-tagged')[0]).toMatchObject({
      environment: 'test',
      tags: {
        workspace: 'workspace-1',
        run: 'run-tagged',
        tradingPartner: 'partner-1',
        channel: 'channel-1',
        failureCode: 'channelDefect',
      },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'channelDefect',
            stacktrace: { frames: [expect.objectContaining({ function: 'deliver', lineno: 10 })] },
          },
        ],
      },
    })
  })

  it('leaves out a Trading Partner and a Channel the Run has none of', async () => {
    await Effect.runPromise(
      monitoring.defectReporter.report({
        workspaceId: 'workspace-1',
        runId: 'run-untagged',
        tradingPartnerId: null,
        channelId: null,
        code: 'processingDefect',
        cause: { name: 'Error', frames: [] },
      }),
    )

    await vi.waitFor(() => {
      expect(eventsOf('run-untagged')).toHaveLength(1)
    })
    expect(
      z.object({ tags: z.record(z.string(), z.string()) }).parse(eventsOf('run-untagged')[0]).tags,
    ).toEqual({
      workspace: 'workspace-1',
      run: 'run-untagged',
      failureCode: 'processingDefect',
    })
  })
})

describe('a defect reported to Sentry without a Run', () => {
  const eventsTagged = (channel: string) =>
    itemsOf('event').filter((event) => JSON.stringify(event).includes(channel))

  it('arrives tagged with the Workspace and Channel of a poll', async () => {
    await Effect.runPromise(
      monitoring.defectReporter.report({
        workspaceId: 'workspace-1',
        runId: null,
        tradingPartnerId: null,
        channelId: 'channel-polled',
        code: 'channelDefect',
        cause: { name: 'Error', frames: [] },
      }),
    )

    await vi.waitFor(() => {
      expect(eventsTagged('channel-polled')).toHaveLength(1)
    })
    expect(
      z.object({ tags: z.record(z.string(), z.string()) }).parse(eventsTagged('channel-polled')[0])
        .tags,
    ).toEqual({ workspace: 'workspace-1', channel: 'channel-polled', failureCode: 'channelDefect' })
  })

  it('arrives tagged with its failure code only for a defect of the polling loop', async () => {
    await Effect.runPromise(
      monitoring.defectReporter.report({
        workspaceId: null,
        runId: null,
        tradingPartnerId: null,
        channelId: null,
        code: 'pollingDefect',
        cause: { name: 'Error', frames: [] },
      }),
    )

    await vi.waitFor(() => {
      expect(eventsTagged('pollingDefect')).toHaveLength(1)
    })
    expect(
      z.object({ tags: z.record(z.string(), z.string()) }).parse(eventsTagged('pollingDefect')[0])
        .tags,
    ).toEqual({ failureCode: 'pollingDefect' })
  })
})

describe('an Effect span', () => {
  it('arrives with its child spans', async () => {
    await Effect.runPromise(
      Effect.void.pipe(
        Effect.withSpan('run.mapping'),
        Effect.withSpan('run.processing', { attributes: { runId: 'run-traced' } }),
        Effect.withTracer(monitoring.tracer),
      ),
    )

    const processing = await vi.waitFor(() => {
      expect(runSpanOf('run-traced')).toMatchObject({ name: 'run.processing', status: 'ok' })

      return runSpanOf('run-traced')
    })

    expect(spans().filter((span) => span.parent_span_id === processing?.span_id)).toEqual([
      expect.objectContaining({ name: 'run.mapping' }),
    ])
  })

  it('continues the trace of the receipt of its Run', async () => {
    const trace = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true }

    await Effect.runPromise(
      runSpan('run-continued', trace).pipe(
        withMonitoring(monitoring, { workspaceId: 'workspace-1', runId: 'run-continued', trace }),
      ),
    )

    await vi.waitFor(() => {
      expect(runSpanOf('run-continued')).toMatchObject({
        trace_id: trace.traceId,
        parent_span_id: trace.spanId,
      })
    })
  })

  it('stays out of a trace the receipt of its Run left unsampled', async () => {
    const trace = { traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), sampled: false }

    await Effect.runPromise(
      runSpan('run-unsampled', trace).pipe(
        withMonitoring(monitoring, { workspaceId: 'workspace-1', runId: 'run-unsampled', trace }),
      ),
    )
    await Effect.runPromise(
      runSpan('run-sampled').pipe(
        withMonitoring(monitoring, { workspaceId: 'workspace-1', runId: 'run-sampled' }),
      ),
    )

    await vi.waitFor(() => {
      expect(runSpanOf('run-sampled')).toBeDefined()
    })
    expect(runSpanOf('run-unsampled')).toBeUndefined()
  })

  it('sends no message of the cause it fails with', async () => {
    await Effect.runPromiseExit(
      Effect.die(new Error(secret)).pipe(
        Effect.withSpan('run.processing', { attributes: { runId: 'run-died' } }),
        Effect.withTracer(monitoring.tracer),
      ),
    )

    await vi.waitFor(() => {
      expect(runSpanOf('run-died')).toMatchObject({ status: 'error' })
    })
    expect(JSON.stringify(sent)).not.toContain('hunter2')
  })
})

describe('an unhandled rejection', () => {
  it('arrives without the messages of its error and its cause', async () => {
    const error = new RangeError(secret, { cause: new SyntaxError(secret) })

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (const handler of rejectionHandlers) {
      handler(error, Promise.resolve())
    }

    const event = await vi.waitFor(() => {
      const [found] = itemsOf('event').filter((item) => JSON.stringify(item).includes('RangeError'))

      expect(found).toBeDefined()

      return found
    })

    expect(event).toMatchObject({
      exception: {
        values: [
          { type: 'SyntaxError', value: 'SyntaxError' },
          { type: 'RangeError', value: 'RangeError' },
        ],
      },
    })
    expect(JSON.stringify(event)).not.toContain('hunter2')
  })
})

describe('an unhandled system error', () => {
  // Joined at runtime, so the context lines of the test's own frames don't carry the file name.
  const fileName = ['ORDERS', 'partner-1', '0042.edi'].join('_')
  const path = `/sftp/inbox/${fileName}`

  const systemError = () => {
    try {
      openSync(path, 'r')
    } catch (error) {
      return error
    }

    throw new Error('the partner file exists')
  }

  const eventOf = (marker: string) =>
    vi.waitFor(() => {
      const [found] = itemsOf('event').filter((item) => JSON.stringify(item).includes(marker))

      expect(found).toBeDefined()

      return found
    })

  it('arrives without the path, the system call or other properties of its error', async () => {
    const error = systemError()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (const handler of rejectionHandlers) {
      handler(error, Promise.resolve())
    }

    const event = await eventOf('"function":"systemError"')

    expect(JSON.stringify(event)).not.toContain(fileName)
    expect(JSON.stringify(event)).not.toContain('"open"')
    expect(event).not.toHaveProperty('contexts.node_system_error')
  })

  it('arrives without a system error context set elsewhere', async () => {
    withScope((scope) => {
      scope.setContext('node_system_error', { path, syscall: 'open' })
      captureException(new URIError('scoped'))
    })

    const event = await eventOf('URIError')

    expect(JSON.stringify(event)).not.toContain(fileName)
    expect(event).not.toHaveProperty('contexts.node_system_error')
  })
})

describe('the Sentry client', () => {
  it.each(['OnUncaughtException', 'OnUnhandledRejection'])('reports %s errors', (name) => {
    expect(getClient()?.getIntegrationByName(name)).toBeDefined()
  })
})
