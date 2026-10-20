import { SPAN_STATUS_ERROR, stripUrlQueryAndFragment } from '@sentry/core'
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

// A query string can carry a token, such as the one of a password reset.
const withoutQueries = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  const scrubbed = { ...event }

  if (event.transaction !== undefined) {
    scrubbed.transaction = stripUrlQueryAndFragment(event.transaction)
  }

  if (event.request !== undefined) {
    const request = { ...event.request }

    delete request.query_string

    if (request.url !== undefined) {
      request.url = stripUrlQueryAndFragment(request.url)
    }

    scrubbed.request = request
  }

  return scrubbed
}

// A system error names its file, such as the file of a Trading Partner, and its peer address.
const withoutSystemErrors = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  if (event.contexts === undefined) {
    return event
  }

  const contexts = { ...event.contexts }

  delete contexts['node_system_error']

  return { ...event, contexts }
}

// The other default integrations trace or log Postgres, Redis and HTTP traffic, which carries Documents.
const keptIntegrations = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'OnUncaughtException',
  'OnUnhandledRejection',
  'ContextLines',
  'Context',
  'Modules',
  // Fastify spans name the routes and hooks of a request, never its body or headers.
  'Fastify',
])

const urlAttributes = new Set(['url.path', 'url.full', 'http.target', 'http.url'])

// A failed span quotes the defect as its status message, and a query can carry a token.
const droppedAttributes = new Set(['sentry.status.message', 'url.query', 'http.query'])

const urlValueSchema = z.union([
  z.string().transform((url) => stripUrlQueryAndFragment(url)),
  z
    .looseObject({ value: z.string() })
    .transform((attribute) => ({ ...attribute, value: stripUrlQueryAndFragment(attribute.value) })),
])

// Bodies, queries, queue jobs and AI prompts carry Documents and Channel secrets; headers carry tokens.
export const sentryOptions = (config: SentryConfig): Sentry.NodeOptions => ({
  ...config,
  integrations: (defaults) => [
    ...defaults.filter(({ name }) => keptIntegrations.has(name)),
    // Gives each request its own scope, so an event names the transaction of its own request.
    Sentry.httpServerIntegration(),
  ],
  enableRuntimeChannelInjection: false,
  beforeBreadcrumb: () => null,
  beforeSend: (event) => withoutSystemErrors(withoutQueries(withoutMessages(event))),
  beforeSendSpan: (span) => ({
    ...span,
    name: stripUrlQueryAndFragment(span.name),
    attributes: Object.fromEntries(
      Object.entries(span.attributes)
        .filter(([key]) => !droppedAttributes.has(key))
        .flatMap(([key, value]) => {
          if (!urlAttributes.has(key)) {
            return [[key, value]]
          }

          const parsed = urlValueSchema.safeParse(value)

          return parsed.success ? [[key, parsed.data]] : []
        }),
    ),
  }),
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
