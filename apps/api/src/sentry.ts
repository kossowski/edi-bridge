import { SPAN_STATUS_ERROR } from '@sentry/core'
import * as Sentry from '@sentry/node'
import { Exit, Option, Tracer } from 'effect'
import { z } from 'zod'

export type SentryConfig = {
  dsn: string
  environment: string | undefined
  tracesSampleRate: number
}

export const sentryFlushTimeoutMs = 2000

// An error message can quote a failed query with its parameters, as the logs can quote a defect.
const withoutMessages = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  const scrubbed = { ...event }
  const values = event.exception?.values

  delete scrubbed.message
  delete scrubbed.logentry

  if (values !== undefined) {
    scrubbed.exception = {
      values: values.map((exception) => ({ ...exception, value: exception.type ?? 'Error' })),
    }
  }

  return scrubbed
}

// Bodies, queries, queue jobs and AI prompts carry Documents and Channel secrets; headers carry tokens.
export const sentryOptions = (config: SentryConfig): Sentry.NodeOptions => ({
  ...config,
  maxBreadcrumbs: 0,
  beforeSend: withoutMessages,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    databaseQueryData: false,
    queues: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
})

type SpanOptions = Parameters<Tracer.Tracer['span']>[0]

const sampledFlag = 0x1

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean()])

const sentryParentOf = ({ parent, root }: SpanOptions) => {
  if (root) {
    return null
  }

  // Without an Effect parent, the span joins the active span, such as the one of the request.
  return Option.match(parent, {
    onNone: () => undefined,
    onSome: (span) => (span instanceof SentryEffectSpan ? span.sentrySpan : undefined),
  })
}

class SentryEffectSpan extends Tracer.NativeSpan {
  readonly sentrySpan: Sentry.Span

  constructor(options: SpanOptions) {
    const parentSpan = sentryParentOf(options)
    const spanOptions: Parameters<typeof Sentry.startInactiveSpan>[0] = { name: options.name }

    if (parentSpan !== undefined) {
      spanOptions.parentSpan = parentSpan
    }

    const sentrySpan = Sentry.startInactiveSpan(spanOptions)

    const { traceId, spanId, traceFlags } = sentrySpan.spanContext()

    super({ ...options, sampled: (traceFlags & sampledFlag) === sampledFlag })

    this.sentrySpan = sentrySpan
    this._traceId = traceId
    this._spanId = spanId
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    super.end(endTime, exit)

    for (const [key, value] of this.attributes) {
      const parsed = attributeValueSchema.safeParse(value)

      if (parsed.success) {
        this.sentrySpan.setAttribute(key, parsed.data)
      }
    }

    if (Exit.isFailure(exit)) {
      this.sentrySpan.setStatus({ code: SPAN_STATUS_ERROR })
    }

    this.sentrySpan.end()
  }
}

// So the queued Run carries a trace id that Sentry knows.
export const sentryTracer = Tracer.make({
  span: (options) =>
    options.sampled ? new SentryEffectSpan(options) : new Tracer.NativeSpan(options),
})
