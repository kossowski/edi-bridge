import {
  type CharacterSetError,
  decodeBytes,
  decodeInterchange,
  hexOf,
  type SyntaxCharacterSet,
} from './character-set'

export type DecodedDocument = { characterSet: SyntaxCharacterSet | undefined } & (
  | { text: string }
  | { readable: string; reason: string; characterSetError: CharacterSetError | undefined }
)

const encodingNamed = (label: string) => {
  try {
    return new TextDecoder(label).encoding
  } catch {
    return undefined
  }
}

export const decodeDocument = (bytes: Uint8Array, label = 'utf-8'): DecodedDocument => {
  const interchange = decodeInterchange(bytes)

  if (interchange !== undefined) {
    const { characterSet } = interchange

    return 'text' in interchange
      ? { characterSet, text: interchange.text }
      : {
          characterSet,
          readable: interchange.readable,
          reason: interchange.error.message,
          characterSetError: interchange.error,
        }
  }

  const encoding = encodingNamed(label)

  if (encoding === undefined) {
    return {
      characterSet: undefined,
      readable: '',
      reason: `The encoding ${label} is unknown`,
      characterSetError: undefined,
    }
  }

  const decoded = decodeBytes(bytes, encoding)

  return 'text' in decoded
    ? { characterSet: undefined, text: decoded.text }
    : {
        characterSet: undefined,
        readable: decoded.readable,
        reason: `Byte ${String(decoded.invalidAt + 1)} (${hexOf(bytes[decoded.invalidAt] ?? 0)}) is not valid ${encoding}`,
        characterSetError: undefined,
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
