import { setupWorker } from 'msw/browser'

import { createHandlers } from '@edi-bridge/mocks'

import { apiUrl } from './config'

export async function startMockWorker() {
  await setupWorker(...createHandlers(apiUrl)).start({ onUnhandledFrame: 'bypass' })
}
