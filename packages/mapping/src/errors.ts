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

export type MissingLookup = {
  readonly lookupTableId: string | null
  readonly code: string
}

export class MappingError extends Data.TaggedError('MappingError')<{
  readonly code: MappingErrorCode
  readonly targetPath: string
  readonly sourcePath?: string
  readonly transformId?: string
  readonly lookup?: MissingLookup
}> {}
