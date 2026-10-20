import { maxDocumentBytes, type MessageType, messageTypeSchema } from '@edi-bridge/contracts'

export type DocumentProblem = 'required' | 'empty' | 'tooLarge'

export function documentProblem(content: string | null): DocumentProblem | null {
  if (content === null) {
    return 'required'
  }

  if (content.length === 0) {
    return 'empty'
  }

  return content.length > maxDocumentBytes ? 'tooLarge' : null
}

export function parseMessageType(messageType: string): MessageType | null {
  const parsed = messageTypeSchema.safeParse(messageType)

  return parsed.success ? parsed.data : null
}
