import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type LiveEvent,
  liveEventsEndpoint,
  type RunSummary,
  runSummarySchema,
} from '@edi-bridge/contracts'

import { generateRun, pickFailureStage, seedRuns } from './run'
import { type RunStore, toRunStore } from './run-store'

export type LiveEventsMode = 'live' | 'quiet' | 'unavailable' | 'dropping'

export type LiveEventsOptions = {
  runs?: ReadonlyArray<RunSummary> | RunStore
  mode?: LiveEventsMode
  intervalMs?: number
  dropAfter?: number
  seed?: number
  signal?: AbortSignal
}

const encoder = new TextEncoder()

const opened = encoder.encode(': connected\n\n')

function frameOf(id: number, event: LiveEvent) {
  return encoder.encode(`id:${id}\ndata:${JSON.stringify(event)}\n\n`)
}

function receive(faker: Faker): RunSummary {
  return runSummarySchema.parse({
    ...generateRun(faker, new Date()),
    status: 'processing',
    failureStage: null,
  })
}

function finish(faker: Faker, run: RunSummary): RunSummary {
  return runSummarySchema.parse(
    faker.datatype.boolean({ probability: 0.15 })
      ? { ...run, status: 'failed', failureStage: pickFailureStage(faker, run.messageType) }
      : { ...run, status: 'delivered', failureStage: null },
  )
}

export function liveEventsHandler(
  apiUrl: string,
  {
    runs,
    mode = 'live',
    intervalMs = 3000,
    dropAfter = 3,
    seed = 73,
    signal,
  }: LiveEventsOptions = {},
) {
  const path = `${apiUrl}${liveEventsEndpoint.path}`

  if (mode === 'unavailable') {
    return http.get(path, () => new HttpResponse(null, { status: 503 }))
  }

  const faker = new Faker({ locale: [en], seed })
  const inFlight: string[] = []
  let store: RunStore | undefined
  let lastId = 0

  function nextChanges(): RunSummary[] {
    store ??= toRunStore(runs ?? seedRuns())

    const finishing = inFlight.shift()
    const pending = finishing === undefined ? undefined : store.get(finishing)
    const received = receive(faker)
    inFlight.push(received.id)

    return [...(pending ? [finish(faker, pending)] : []), received]
  }

  return http.get(path, ({ request }) => {
    let timer: ReturnType<typeof setInterval> | undefined
    let close = () => {}

    const stop = () => {
      clearInterval(timer)
      signal?.removeEventListener('abort', close)
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => {
          stop()
          controller.close()
        }

        if (signal?.aborted) {
          controller.close()

          return
        }

        signal?.addEventListener('abort', close, { once: true })
        controller.enqueue(opened)

        if (mode === 'quiet') {
          return
        }

        let sent = 0

        timer = setInterval(() => {
          if (mode === 'dropping' && sent >= dropAfter) {
            stop()
            controller.error(new Error('Live event stream dropped'))

            return
          }

          try {
            for (const run of nextChanges()) {
              store!.set(run)
              lastId += 1
              controller.enqueue(frameOf(lastId, { type: 'run.changed', run }))
              sent += 1
            }
          } catch {
            stop()
          }
        }, intervalMs)
      },
      cancel: () => stop(),
    })

    request.signal.addEventListener('abort', () => stop(), { once: true })

    return new HttpResponse(body, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  })
}
