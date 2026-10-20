import { Data } from 'effect'

import {
  type CharacterSetError,
  decodeBytes,
  decodeInterchange,
  hexOf,
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

const encodingNamed = (label: string) => {
  try {
    return new TextDecoder(label).encoding
  } catch {
    return undefined
  }
}

export const decodeDocument = (bytes: Buffer, label = 'utf-8'): DecodedDocument => {
  const interchange = decodeInterchange(bytes)

  if (interchange !== undefined) {
    const { characterSet } = interchange

    return 'text' in interchange
      ? { bytes, characterSet, text: interchange.text }
      : {
          bytes,
          characterSet,
          readable: interchange.readable,
          undecodable: new DocumentUndecodable({
            message: interchange.error.message,
            characterSetError: interchange.error,
          }),
        }
  }

  const encoding = encodingNamed(label)

  if (encoding === undefined) {
    return {
      bytes,
      characterSet: undefined,
      readable: '',
      undecodable: new DocumentUndecodable({
        message: `The encoding ${label} is unknown`,
        characterSetError: undefined,
      }),
    }
  }

  const decoded = decodeBytes(bytes, encoding)

  return 'text' in decoded
    ? { bytes, characterSet: undefined, text: decoded.text }
    : {
        bytes,
        characterSet: undefined,
        readable: decoded.readable,
        undecodable: new DocumentUndecodable({
          message: `Byte ${String(decoded.invalidAt + 1)} (${hexOf(bytes[decoded.invalidAt] ?? 0)}) is not valid ${encoding}`,
          characterSetError: undefined,
        }),
      }
}

// WHATWG reads the labels us-ascii and iso-8859-1 as windows-1252.
const encodingsOf: Record<SyntaxCharacterSet, readonly string[]> = {
  UNOA: ['windows-1252', 'utf-8'],
  UNOB: ['windows-1252', 'utf-8'],
  UNOC: ['windows-1252'],
  UNOD: ['iso-8859-2'],
  UNOE: ['iso-8859-5'],
  UNOF: ['iso-8859-7'],
  UNOW: ['utf-8'],
  UNOY: ['utf-8'],
}

export const namesOtherEncoding = (characterSet: SyntaxCharacterSet, label: string) => {
  const encoding = encodingNamed(label)

  return encoding === undefined || !encodingsOf[characterSet].includes(encoding)
}
