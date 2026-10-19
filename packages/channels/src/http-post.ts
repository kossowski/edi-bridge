import { Effect } from 'effect'

import {
  fetchFailureReasonSchema,
  type HttpDestination,
  timingOut,
  unreachable,
} from './channel-reach'
import { DeliveryFailed, type OutboundDocument } from './delivery'

const answerFailure = (status: number) =>
  Effect.fail(
    unreachable(status === 401 || status === 403 ? 'loginRejected' : 'unexpectedResponse'),
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
      try: (signal) =>
        fetch(url, {
          method: 'POST',
          redirect: 'manual',
          headers: postHeaders(authorization, document),
          body: document.content,
          signal,
        }),
      catch: (error) => unreachable(fetchFailureReasonSchema.parse(error)),
    }).pipe(
      Effect.flatMap((response) => (response.ok ? Effect.void : answerFailure(response.status))),
    ),
    timeoutMs,
  ).pipe(Effect.mapError(({ reason }) => new DeliveryFailed({ reason })))
