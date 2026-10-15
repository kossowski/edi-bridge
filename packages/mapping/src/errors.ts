import { Data } from 'effect'

export const mappingErrorCodes = [
  'missingRequiredValue',
  'outsideLoop',
  'unknownSource',
  'unknownTarget',
  'invalidTransform',
  'invalidDate',
  'invalidNumber',
  'unknownLookupTable',
  'noLookupMatch',
  'expressionFailed',
] as const

export type MappingErrorCode = (typeof mappingErrorCodes)[number]

export class MappingError extends Data.TaggedError('MappingError')<{
  readonly code: MappingErrorCode
  readonly targetPath: string
  readonly transformId?: string
}> {}
