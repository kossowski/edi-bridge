import * as Sentry from '@sentry/nextjs'

import { browserSentryOptions } from '@/lib/sentry'

const options = browserSentryOptions()

if (options !== undefined) {
  Sentry.init(options)
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
