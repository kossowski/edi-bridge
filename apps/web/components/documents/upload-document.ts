import { maxDocumentLength, type MessageType, messageTypeSchema } from '@edi-bridge/contracts'

export type DocumentProblem = 'required' | 'empty' | 'tooLarge'

export function documentProblem(content: string | null): DocumentProblem | null {
  if (content === null) {
    return 'required'
  }

  if (content.length === 0) {
    return 'empty'
  }

  return content.length > maxDocumentLength ? 'tooLarge' : null
}

export function knownMessageType(messageType: string): MessageType | null {
  const known = messageTypeSchema.safeParse(messageType)

  return known.success ? known.data : null
}
