import { z } from 'zod'

import type { addIntegration, BrowserOptions, ErrorEvent, NodeOptions } from '@sentry/nextjs'
import type { SentryBuildOptions } from '@sentry/nextjs/config'

export type SentryConfig = {
  dsn: string
  environment: string | undefined
  tracesSampleRate: number
}

type SentryEnv = {
  SENTRY_DSN?: string | undefined
  SENTRY_ENVIRONMENT?: string | undefined
  SENTRY_TRACES_SAMPLE_RATE?: string | undefined
}

type Integration = Parameters<typeof addIntegration>[0]

type SpanJSON = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0]

const defaultTracesSampleRate = 0.1

// An empty value in an env file or a build argument leaves the variable unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const sentryEnvSchema = z.object({
  SENTRY_DSN: optional(z.url()),
  SENTRY_ENVIRONMENT: optional(z.string()),
  SENTRY_TRACES_SAMPLE_RATE: optional(z.coerce.number().min(0).max(1)),
})

export function sentryConfig(env: SentryEnv, prefix = ''): SentryConfig | undefined {
  const parsed = sentryEnvSchema.safeParse(env)

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      ({ path, message }) => `${prefix}${path.join('.')}: ${message}`,
    )

    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`)
  }

  const { SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_TRACES_SAMPLE_RATE } = parsed.data

  return SENTRY_DSN === undefined
    ? undefined
    : {
        dsn: SENTRY_DSN,
        environment: SENTRY_ENVIRONMENT,
        tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE ?? defaultTracesSampleRate,
      }
}

const withoutQuery = (text: string) => text.replace(/[?#]\S*/g, '')

// The body, query, cookies and headers of a request can carry a Document, a search or a session.
const withoutRequestData = (event: ErrorEvent): ErrorEvent => {
  if (event.request === undefined) {
    return event
  }

  const { url, method } = event.request
  const request: NonNullable<ErrorEvent['request']> = {}

  if (url !== undefined) {
    request.url = withoutQuery(url)
  }

  if (method !== undefined) {
    request.method = method
  }

  return { ...event, request }
}

// An error message can quote a Document that the page shows or failed to parse.
const withoutMessages = (event: ErrorEvent): ErrorEvent => {
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

// A system error names its file, such as the file of a Trading Partner, and its peer address.
const withoutSystemErrors = (event: ErrorEvent): ErrorEvent => {
  if (event.contexts === undefined) {
    return event
  }

  const contexts = { ...event.contexts }

  delete contexts['node_system_error']

  return { ...event, contexts }
}

const droppedSpanAttributes = new Set([
  'sentry.status.message',
  'url.query',
  'url.fragment',
  'http.query',
  'http.fragment',
])

const urlSpanAttributes = new Set([
  'url',
  'url.full',
  'url.path',
  'http.target',
  'http.url',
  'next.span_name',
])

// A query can carry a token, such as the one of a reset-password link.
const scrubbedSpan = (span: SpanJSON): SpanJSON => ({
  ...span,
  name: withoutQuery(span.name),
  attributes: Object.fromEntries(
    Object.entries(span.attributes)
      .filter(([key]) => !droppedSpanAttributes.has(key))
      .map(([key, value]) => {
        const text = z.string().safeParse(value)

        return [key, urlSpanAttributes.has(key) && text.success ? withoutQuery(text.data) : value]
      }),
  ),
})

// Bodies, queries, AI prompts and breadcrumbs of console output, fetches and clicks can show a Document.
const commonOptions = (config: SentryConfig) => ({
  ...config,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    stackFrameVariables: false,
    databaseQueryData: false,
    queues: false,
    genAI: { inputs: false, outputs: false },
  },
  beforeBreadcrumb: () => null,
  beforeSend: (event: ErrorEvent) =>
    withoutSystemErrors(withoutMessages(withoutRequestData(event))),
  beforeSendSpan: scrubbedSpan,
})

// Next inlines a NEXT_PUBLIC_ variable into the browser bundle only where the code names it in full.
export function browserSentryOptions(): BrowserOptions | undefined {
  const config = sentryConfig(
    {
      SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    },
    'NEXT_PUBLIC_',
  )

  return config === undefined ? undefined : commonOptions(config)
}

// The other default integrations trace or log HTTP traffic and console output, which can carry Documents,
// or copy the file path of a system error, which can name the file of a Trading Partner.
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
  'DistDirRewriteFrames',
])

export const serverIntegrations = (defaults: Integration[]) =>
  defaults.filter(({ name }) => keptIntegrations.has(name))

export function serverSentryOptions(): NodeOptions | undefined {
  const config = sentryConfig({
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
  })

  return config === undefined
    ? undefined
    : {
        ...commonOptions(config),
        integrations: serverIntegrations,
      }
}

export function sentryBuildOptions(): SentryBuildOptions {
  const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env
  const quiet = { telemetry: false, silent: true }

  return SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT
    ? {
        ...quiet,
        authToken: SENTRY_AUTH_TOKEN,
        org: SENTRY_ORG,
        project: SENTRY_PROJECT,
        sourcemaps: { disable: false },
        release: { create: true },
      }
    : { ...quiet, sourcemaps: { disable: true }, release: { create: false } }
}
