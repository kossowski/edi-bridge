import * as Sentry from '@sentry/nextjs'

import { serverSentryOptions } from '@/lib/sentry'

export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }

  const options = serverSentryOptions()

  if (options !== undefined) {
    Sentry.init(options)
  }
}

export const onRequestError = Sentry.captureRequestError
