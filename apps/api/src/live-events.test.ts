import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { LightMyRequestResponse } from 'fastify'

import {
  type LiveEvent,
  liveEventsEndpoint,
  parseLiveEvent,
  signOutEndpoint,
} from '@edi-bridge/contracts'
import { members } from '@edi-bridge/db'

import { buildApp } from './app.js'
import {
  addMember,
  type Client,
  memoryLiveEvents,
  type NewMember,
  otherWorkspace,
  ownAdmin,
  ownWorkspace,
  signIn,
  startTestApi,
  type TestApi,
  testAuth,
  testChannels,
  testRunQueue,
  webOrigin,
} from './testing.js'
import { memoryWebhookRateLimiter } from './webhook-rate-limit.js'

let api: TestApi

const heartbeatMs = 50

beforeAll(async () => {
  api = await startTestApi({ liveEventHeartbeatMs: heartbeatMs })
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const changed = (businessReference: string): LiveEvent => ({
  type: 'run.changed',
  run: {
    id: '6f1c2a5e-8d4b-4c3e-9a7f-1b2c3d4e5f60',
    status: 'delivered',
    failureStage: null,
    problem: null,
    receivedAt: '2026-10-10T12:00:00.000Z',
    tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
    messageType: 'ORDERS',
    direction: 'inbound',
    flow: { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS' },
    manualSubmission: false,
    businessReference,
    interchange: null,
  },
})

const publish = (workspaceId: string, event: LiveEvent) =>
  Effect.runPromise(api.liveEvents.service.publish({ workspaceId, event }))

const openStream = (client: Client) =>
  client.inject({
    method: 'GET',
    url: liveEventsEndpoint.path,
    headers: { accept: 'text/event-stream' },
    payloadAsStream: true,
  })

// Reads the stream frame by frame, so a test waits for the frame it expects instead of sleeping.
const framesOf = (response: LightMyRequestResponse) => {
  const chunks = response.stream()[Symbol.asyncIterator]()
  let buffered = ''

  return async (wanted: (frame: string) => boolean) => {
    for (;;) {
      const frames = buffered.split('\n\n')

      buffered = frames.pop() ?? ''

      const found = frames.find(wanted)

      if (found !== undefined) {
        buffered = [...frames.slice(frames.indexOf(found) + 1), buffered].join('\n\n')

        return found
      }

      const chunk = await chunks.next()

      if (chunk.done === true) {
        throw new Error('The stream ended before the frame arrived')
      }

      buffered += String(chunk.value)
    }
  }
}

const isEvent = (frame: string) => frame.startsWith('data:')

const eventOf = (frame: string) => parseLiveEvent(frame.slice('data:'.length))

const closed = (response: LightMyRequestResponse) => {
  response.raw.res.destroy()
}

describe('GET /events', () => {
  it('streams a change of a Run in the Workspace of the Member', async () => {
    const response = await openStream(api.admin)
    const nextFrame = framesOf(response)

    await publish(ownWorkspace.id, changed('PO000001'))

    expect(eventOf(await nextFrame(isEvent))).toEqual(changed('PO000001'))

    closed(response)
  })

  it('leaves out the changes of another Workspace', async () => {
    const response = await openStream(api.admin)
    const nextFrame = framesOf(response)

    await publish(otherWorkspace.id, changed('PO-OTHER'))
    await publish(ownWorkspace.id, changed('PO000002'))

    expect(eventOf(await nextFrame(isEvent))).toEqual(changed('PO000002'))

    closed(response)
  })

  it('lets the web origin read the stream with its session cookie, unbuffered by proxies', async () => {
    const response = await openStream(api.admin)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.headers['cache-control']).toContain('no-cache')
    expect(response.headers['x-accel-buffering']).toBe('no')
    expect(response.headers['access-control-allow-origin']).toBe(webOrigin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')

    closed(response)
  })

  it('keeps an idle stream open with heartbeat comments', async () => {
    const response = await openStream(api.admin)
    const nextFrame = framesOf(response)

    expect(await nextFrame((frame) => frame === ':heartbeat')).toBe(':heartbeat')

    closed(response)
  })

  it('answers 401 without a session', async () => {
    const response = await api.app.inject({ method: 'GET', url: liveEventsEndpoint.path })

    expect(response.statusCode).toBe(401)
  })

  it('ends the subscription when the client goes away', async () => {
    const listening = api.liveEvents.listening()
    const response = await openStream(api.admin)

    expect(api.liveEvents.listening()).toBe(listening + 1)

    closed(response)

    await vi.waitFor(() => {
      expect(api.liveEvents.listening()).toBe(listening)
    })
  })

  it('ends the stream once its Member signs out', async () => {
    const client = await signIn(api.app, ownAdmin)
    const response = await openStream(client)

    await client.inject({ method: 'POST', url: signOutEndpoint.path })

    await expect(framesOf(response)(isEvent)).rejects.toThrow('The stream ended')
  })

  it('ends the stream once its Member leaves the Workspace', async () => {
    const leaving: NewMember = {
      name: 'Nordwind Leaver',
      email: 'leaver@nordwind.example',
      password: 'nordwind-leaver-password',
      workspaceId: ownWorkspace.id,
      role: 'viewer',
    }

    const userId = await addMember(api.connection.db, leaving)
    const response = await openStream(await signIn(api.app, leaving))

    await api.connection.db
      .delete(members)
      .where(and(eq(members.userId, userId), eq(members.workspaceId, ownWorkspace.id)))

    await expect(framesOf(response)(isEvent)).rejects.toThrow('The stream ended')
  })

  it('ends its open streams when the api closes', async () => {
    const liveEvents = memoryLiveEvents()

    const app = buildApp({
      auth: testAuth,
      channels: testChannels,
      database: api.connection.db,
      liveEventHeartbeatMs: heartbeatMs,
      liveEvents,
      probes: { postgres: () => Promise.resolve(), redis: () => Promise.resolve() },
      runQueue: testRunQueue().service,
      webOrigin,
      webhookRateLimiter: memoryWebhookRateLimiter(),
    })

    const response = await openStream(await signIn(app, ownAdmin))

    await app.close()

    expect(liveEvents.listening()).toBe(0)
    await expect(framesOf(response)(() => false)).rejects.toThrow('The stream ended')
  })
})
