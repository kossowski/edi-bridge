import { Effect } from 'effect'

import {
  type ConnectOptions,
  type HttpDestination,
  httpRequest,
  rejectedLoginReason,
  timingOut,
} from './channel-reach'
import { DeliveryFailed, deliveryFailed, type OutboundDocument } from './delivery'
import { type HttpChannel, httpDestination } from './http-channel'

import type { SecretBox } from './secret'

const answerFailure = (status: number) =>
  Effect.fail(
    new DeliveryFailed({
      reason: rejectedLoginReason(status) ?? 'unexpectedResponse',
      details: { kind: 'httpResponse', status },
    }),
  )

const postHeaders = (authorization: string | null, document: OutboundDocument) => ({
  'content-type': document.mediaType ?? 'application/octet-stream',
  ...(authorization !== null && { authorization }),
})

export const postHttp = (
  { url, authorization }: HttpDestination,
  document: OutboundDocument,
  options: ConnectOptions,
) =>
  timingOut(
    httpRequest(
      url,
      { method: 'POST', headers: postHeaders(authorization, document), body: document.content },
      options,
    ),
    options.timeoutMs,
  ).pipe(
    Effect.mapError(deliveryFailed),
    Effect.flatMap((response) => (response.ok ? Effect.void : answerFailure(response.status))),
  )

export const httpChannelDelivery =
  ({ secrets, ...options }: ConnectOptions & { secrets: SecretBox }) =>
  (channel: HttpChannel, document: OutboundDocument) =>
    Effect.flatMap(
      Effect.sync(() => httpDestination(secrets, channel)),
      (destination) => postHttp(destination, document, options),
    )
