import { setupWorker, type StartOptions } from 'msw/browser'

import { createHandlers } from '@edi-bridge/mocks'

import { apiUrl } from './config'

export async function startMockWorker(options: StartOptions = {}) {
  const worker = setupWorker(...createHandlers(apiUrl))
  await worker.start({ onUnhandledFrame: 'bypass', ...options })

  return worker
}
