import { Data } from 'effect'

import {
  type CharacterSetError,
  decodeDocument as decodeDocumentText,
  type SyntaxCharacterSet,
} from '@edi-bridge/edifact'

export class DocumentUndecodable extends Data.TaggedError('DocumentUndecodable')<{
  readonly message: string
  readonly characterSetError: CharacterSetError | undefined
}> {}

export type DecodedDocument = {
  bytes: Buffer
  characterSet: SyntaxCharacterSet | undefined
} & ({ text: string } | { readable: string; undecodable: DocumentUndecodable })

export const decodeDocument = (bytes: Buffer, label?: string): DecodedDocument => {
  const decoded = decodeDocumentText(bytes, label)
  const { characterSet } = decoded

  return 'text' in decoded
    ? { bytes, characterSet, text: decoded.text }
    : {
        bytes,
        characterSet,
        readable: decoded.readable,
        undecodable: new DocumentUndecodable({
          message: decoded.reason,
          characterSetError: decoded.characterSetError,
        }),
      }
}
