import type { readInterchange } from '@edi-bridge/edifact'

type ReadMessages = ReturnType<typeof readInterchange>['messages']

// An outbound Run, a test send too, has no Message Index: its Interchange holds one Message.
const onlyMessage = 1

export const messageAt = (messages: ReadMessages, messageIndex: number | null) => {
  const message = messages[(messageIndex ?? onlyMessage) - 1]?.message
  const reference = message?.header.elements[0]?.[0]

  return message === undefined || reference === undefined || reference === ''
    ? null
    : { message, reference }
}
