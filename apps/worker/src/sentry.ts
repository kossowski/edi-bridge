import * as OtelTracer from '@effect/opentelemetry/OtelTracer'
import * as Sentry from '@sentry/node'
import { Effect, type Tracer } from 'effect'

import {
  type DefectCause,
  type DefectCode,
  type DefectReport,
  DefectReporter,
  type DefectReporterService,
  type QueuedRun,
} from '@edi-bridge/pipeline'

export type SentryConfig = {
  dsn: string
  environment: string | undefined
  tracesSampleRate: number
}

export type Monitoring = {
  defectReporter: DefectReporterService
  tracer: Tracer.Tracer
}

// Sentry reads the frames from the stack; the failure code stands in for the defect's message.
const errorOf = ({ name, frames }: DefectCause, code: DefectCode) => {
  const error = new Error(code)

  error.name = name
  error.stack = [`${name}: ${code}`, ...frames.map((frame) => `    ${frame}`)].join('\n')

  return error
}

// The other default integrations trace or log Postgres, Redis and HTTP traffic, which carries Documents.
// NodeSystemError stays off: the path or address of a system error can name a partner's file.
const crashIntegrations = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'OnUncaughtException',
  'OnUnhandledRejection',
  'ContextLines',
  'Context',
  'Modules',
])

type DefectTags = {
  workspace?: string
  run?: string
  tradingPartner?: string
  channel?: string
  failureCode: DefectCode
}

// A defect of a poll or the sweep has no Run, and one of the whole loop no Workspace either.
const tagsOf = ({ workspaceId, runId, tradingPartnerId, channelId, code }: DefectReport) => {
  const tags: DefectTags = { failureCode: code }

  if (workspaceId !== null) {
    tags.workspace = workspaceId
  }

  if (runId !== null) {
    tags.run = runId
  }

  if (tradingPartnerId !== null) {
    tags.tradingPartner = tradingPartnerId
  }

  if (channelId !== null) {
    tags.channel = channelId
  }

  return tags
}

// A defect event keeps its failure code, which errorOf put in place of the message.
// The properties of a system error, such as its path, are dropped as well.
const withoutMessages = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  const scrubbed = { ...event }
  const values = event.exception?.values

  delete scrubbed.message

  if (event.contexts !== undefined) {
    scrubbed.contexts = { ...event.contexts }
    delete scrubbed.contexts.node_system_error
  }

  if (values !== undefined && event.tags?.failureCode === undefined) {
    scrubbed.exception = {
      values: values.map((exception) => ({ ...exception, value: exception.type ?? 'Error' })),
    }
  }

  return scrubbed
}

export function startSentry(
  { dsn, environment, tracesSampleRate }: SentryConfig,
  transport = Sentry.makeNodeTransport,
): Monitoring {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate,
    transport,
    integrations: (defaults) => defaults.filter(({ name }) => crashIntegrations.has(name)),
    enableRuntimeChannelInjection: false,
    // Effect exports its spans through the OpenTelemetry API.
    enableOpenTelemetrySetup: true,
    // Error messages, also of logs and of failed spans, can carry a Document or a Channel secret.
    beforeBreadcrumb: () => null,
    beforeSend: withoutMessages,
    beforeSendSpan: (span) => ({
      ...span,
      attributes: Object.fromEntries(
        Object.entries(span.attributes).filter(([key]) => key !== 'sentry.status.message'),
      ),
    }),
  })

  return {
    defectReporter: {
      report: (report) =>
        Effect.sync(() => {
          Sentry.captureException(errorOf(report.cause, report.code), { tags: tagsOf(report) })
        }),
    },
    tracer: Effect.runSync(OtelTracer.make.pipe(Effect.provide(OtelTracer.layerGlobalTracer))),
  }
}

export const stopSentry = () => Sentry.close(2000)

// Sentry samples a Run whose receipt left no sampling decision, but never one its receipt left out.
export const withMonitoring =
  (monitoring: Monitoring | undefined, queued?: QueuedRun) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    monitoring === undefined
      ? effect
      : effect.pipe(
          Effect.provideService(DefectReporter, monitoring.defectReporter),
          queued?.trace?.sampled === false
            ? Effect.withTracerEnabled(false)
            : Effect.withTracer(monitoring.tracer),
        )
