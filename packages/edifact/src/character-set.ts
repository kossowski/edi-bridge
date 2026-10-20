import { ParseError, positionAfter, readInterchange } from './parse'
import { describePosition, type Position } from './position'

export const syntaxCharacterSets = [
  'UNOA',
  'UNOB',
  'UNOC',
  'UNOD',
  'UNOE',
  'UNOF',
  'UNOW',
  'UNOY',
] as const

export type SyntaxCharacterSet = (typeof syntaxCharacterSets)[number]

export type DecodedBytes = { text: string } | { readable: string; invalidAt: number }

export class CharacterSetError extends Error {
  override readonly name = 'CharacterSetError'

  constructor(
    readonly characterSet: SyntaxCharacterSet,
    // Counts from 1, as positions do.
    readonly byte: number,
    readonly value: number,
    readonly position: Position,
    readonly tag: string,
  ) {
    super(
      `Byte ${String(byte)} (0x${value.toString(16).toUpperCase().padStart(2, '0')}) is not valid in ${characterSet} (${characterSetNames[characterSet]}), at ${describePosition(position)}`,
    )
  }
}

export type DecodedInterchange =
  | { characterSet: SyntaxCharacterSet; text: string }
  | { characterSet: SyntaxCharacterSet; readable: string; error: CharacterSetError }

const characterSetNames: Record<SyntaxCharacterSet, string> = {
  UNOA: 'ASCII',
  UNOB: 'ASCII',
  UNOC: 'ISO 8859-1',
  UNOD: 'ISO 8859-2',
  UNOE: 'ISO 8859-5',
  UNOF: 'ISO 8859-7',
  UNOW: 'UTF-8',
  UNOY: 'UTF-8',
}

const byteOrderMark = [0xef, 0xbb, 0xbf]

const withoutByteOrderMark = (bytes: Uint8Array) =>
  byteOrderMark.every((value, index) => bytes[index] === value)
    ? bytes.subarray(byteOrderMark.length)
    : bytes

const fatallyDecodes = (label: string, bytes: Uint8Array, stream: boolean) => {
  try {
    new TextDecoder(label, { fatal: true }).decode(bytes, { stream })

    return true
  } catch {
    return false
  }
}

// A streamed prefix fails from the byte that breaks a sequence on, so the search finds that byte first.
const firstInvalidOffset = (label: string, bytes: Uint8Array) => {
  let valid = 0
  let invalid = bytes.length

  while (invalid - valid > 1) {
    const middle = Math.floor((valid + invalid) / 2)

    if (fatallyDecodes(label, bytes.subarray(0, middle), true)) {
      valid = middle
    } else {
      invalid = middle
    }
  }

  let start = valid

  // The broken sequence starts after the longest prefix that decodes complete.
  while (start > 0 && !fatallyDecodes(label, bytes.subarray(0, start), false)) {
    start--
  }

  return start
}

// WHATWG decodes the label iso-8859-1 as windows-1252, so ISO 8859-1 and ASCII decode on their own.
export const decodeBytes = (bytes: Uint8Array, label: string): DecodedBytes => {
  const readable = new TextDecoder(label).decode(bytes)

  return fatallyDecodes(label, bytes, false)
    ? { text: readable }
    : { readable, invalidAt: firstInvalidOffset(label, bytes) }
}

// Spread arguments have a limit, so the bytes go to fromCharCode in chunks.
const chunkLength = 8192

// Every byte is the ISO 8859-1 code point of its value.
const latin1 = (bytes: Uint8Array) => {
  let text = ''

  for (let start = 0; start < bytes.length; start += chunkLength) {
    text += String.fromCharCode(...bytes.subarray(start, start + chunkLength))
  }

  return text
}

const decodeAscii = (bytes: Uint8Array): DecodedBytes => {
  const invalidAt = bytes.findIndex((value) => value > 0x7f)

  return invalidAt === -1
    ? { text: latin1(bytes) }
    : { readable: latin1(bytes).replaceAll(/[\u0080-ÿ]/gu, '�'), invalidAt }
}

const decoders: Record<SyntaxCharacterSet, (bytes: Uint8Array) => DecodedBytes> = {
  UNOA: decodeAscii,
  UNOB: decodeAscii,
  UNOC: (bytes) => ({ text: latin1(bytes) }),
  UNOD: (bytes) => decodeBytes(bytes, 'iso-8859-2'),
  UNOE: (bytes) => decodeBytes(bytes, 'iso-8859-5'),
  UNOF: (bytes) => decodeBytes(bytes, 'iso-8859-7'),
  UNOW: (bytes) => decodeBytes(bytes, 'utf-8'),
  UNOY: (bytes) => decodeBytes(bytes, 'utf-8'),
}

// A UNB is long enough to fit, whatever its optional elements hold.
const headerBytes = 1024

const isSyntaxCharacterSet = (identifier: string | undefined): identifier is SyntaxCharacterSet =>
  syntaxCharacterSets.some((characterSet) => characterSet === identifier)

// Every syntax writes the service segments in ASCII, so ISO 8859-1 reads the UNB of any of them.
const characterSetOf = (bytes: Uint8Array) => {
  try {
    const identifier = readInterchange(latin1(bytes.subarray(0, headerBytes))).header
      ?.elements[0]?.[0]

    return isSyntaxCharacterSet(identifier) ? identifier : undefined
  } catch (error) {
    if (error instanceof ParseError) {
      return undefined
    }

    throw error
  }
}

export const decodeInterchange = (received: Uint8Array): DecodedInterchange | undefined => {
  const bytes = withoutByteOrderMark(received)
  const characterSet = characterSetOf(bytes)

  if (characterSet === undefined) {
    return undefined
  }

  const decode = decoders[characterSet]
  const decoded = decode(bytes)

  if ('text' in decoded) {
    return { characterSet, text: decoded.text }
  }

  const before = decode(bytes.subarray(0, decoded.invalidAt))
  const { position, tag } = positionAfter('text' in before ? before.text : before.readable)
  const byte = decoded.invalidAt + 1 + received.length - bytes.length

  return {
    characterSet,
    readable: decoded.readable,
    error: new CharacterSetError(characterSet, byte, bytes[decoded.invalidAt] ?? 0, position, tag),
  }
}
