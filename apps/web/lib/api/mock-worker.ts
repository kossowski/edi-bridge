import { setupWorker, type StartOptions } from 'msw/browser'

import { createHandlers, type LiveEventsMode } from '@edi-bridge/mocks'

import { apiUrl, mockLiveEvents } from './config'

export async function startMockWorker({
  liveEvents = mockLiveEvents,
  ...options
}: StartOptions & { liveEvents?: LiveEventsMode } = {}) {
  const worker = setupWorker(...createHandlers(apiUrl, { liveEvents: { mode: liveEvents } }))
  await worker.start({ onUnhandledFrame: 'bypass', ...options })

  return worker
}
