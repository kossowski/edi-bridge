import type { CharacterEncoding } from '@edi-bridge/contracts'

// Names of the character encodings, the same in every locale.
export const encodingLabels = {
  'utf-8': 'UTF-8',
  'windows-1252': 'Windows-1252',
} as const satisfies Record<CharacterEncoding, string>
