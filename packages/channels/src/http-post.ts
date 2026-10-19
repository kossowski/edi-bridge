import { Effect } from 'effect'

import {
  fetchFailureReasonSchema,
  type HttpDestination,
  rejectedLoginReason,
  timingOut,
  unreachable,
} from './channel-reach'
import { DeliveryFailed, type OutboundDocument } from './delivery'
import { type HttpChannel, httpDestination } from './http-channel'

import type { SecretBox } from './secret'

const answerFailure = (status: number) =>
  Effect.fail(
    new DeliveryFailed({
      reason: rejectedLoginReason(status) ?? 'unexpectedResponse',
      details: { kind: 'httpResponse', status },
    }),
  )

const postHeaders = (authorization: string | null, document: OutboundDocument) => {
  const headers = new Headers({
    'content-type': document.mediaType ?? 'application/octet-stream',
  })

  if (authorization !== null) {
    headers.set('authorization', authorization)
  }

  return headers
}

export const postHttp = (
  { url, authorization }: HttpDestination,
  document: OutboundDocument,
  { timeoutMs }: { timeoutMs: number },
) =>
  timingOut(
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'manual',
          headers: postHeaders(authorization, document),
          body: document.content,
          signal,
        })

        // An unread body holds its keep-alive connection until garbage collection.
        await response.body?.cancel()

        return response
      },
      catch: (error) => unreachable(fetchFailureReasonSchema.parse(error)),
    }),
    timeoutMs,
  ).pipe(
    Effect.mapError(({ reason }) => new DeliveryFailed({ reason })),
    Effect.flatMap((response) => (response.ok ? Effect.void : answerFailure(response.status))),
  )

export const httpChannelDelivery =
  ({ secrets, timeoutMs }: { secrets: SecretBox; timeoutMs: number }) =>
  (channel: HttpChannel, document: OutboundDocument) =>
    Effect.flatMap(
      Effect.sync(() => httpDestination(secrets, channel)),
      (destination) => postHttp(destination, document, { timeoutMs }),
    )
