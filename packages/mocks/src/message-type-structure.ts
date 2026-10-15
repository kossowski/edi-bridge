import { http, HttpResponse } from 'msw'

import {
  messageTypeSchema,
  messageTypeStructureEndpoint,
  messageTypeStructures,
} from '@edi-bridge/contracts'

import { notFound } from './responses'

export function messageTypeStructureHandler(apiUrl: string) {
  return http.get<{ messageType: string }>(
    `${apiUrl}${messageTypeStructureEndpoint.path}`,
    ({ params }) => {
      const messageType = messageTypeSchema.safeParse(params.messageType)

      return messageType.success
        ? HttpResponse.json(messageTypeStructures[messageType.data])
        : notFound()
    },
  )
}
