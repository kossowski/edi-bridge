import { setupWorker, type StartOptions } from 'msw/browser'

import { createHandlers, type LiveEventsMode } from '@edi-bridge/mocks'

import { apiUrl } from './config'

export async function startMockWorker(
  options: StartOptions = {},
  liveEvents: LiveEventsMode = 'quiet',
) {
  const worker = setupWorker(...createHandlers(apiUrl, { liveEvents: { mode: liveEvents } }))
  await worker.start({ onUnhandledFrame: 'bypass', ...options })

  return worker
}
