import { Effect } from 'effect'

import {
  type MessageTypeStructure,
  messageTypeSchema,
  messageTypeStructures,
} from '@edi-bridge/contracts'

import { NotFound } from './errors.js'

export const loadMessageTypeStructure = (
  messageType: string,
): Effect.Effect<MessageTypeStructure, NotFound> => {
  const known = messageTypeSchema.safeParse(messageType)

  return known.success
    ? Effect.succeed(messageTypeStructures[known.data])
    : Effect.fail(new NotFound())
}
