import { maxDocumentBytes, type MessageType, messageTypeSchema } from '@edi-bridge/contracts'
import { decodeInterchange } from '@edi-bridge/edifact'

export type DocumentProblem = 'required' | 'empty' | 'tooLarge'

export function documentProblem(bytes: Uint8Array | null): DocumentProblem | null {
  if (bytes === null) {
    return 'required'
  }

  if (bytes.byteLength === 0) {
    return 'empty'
  }

  return bytes.byteLength > maxDocumentBytes ? 'tooLarge' : null
}

// The api decodes such an Interchange by its UNB and ignores a chosen encoding.
export function namesItsCharacterSet(bytes: Uint8Array): boolean {
  return decodeInterchange(bytes) !== undefined
}

export function parseMessageType(messageType: string): MessageType | null {
  const parsed = messageTypeSchema.safeParse(messageType)

  return parsed.success ? parsed.data : null
}
