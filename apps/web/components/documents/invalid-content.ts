import { type ValidationErrorCode, validationErrorCodes } from '@edi-bridge/edifact'

export type InvalidContentCode = ValidationErrorCode | 'other'

// Mapping and Document write errors fail with invalidContent too, under codes of their own.
export function invalidContentCode(code: string): InvalidContentCode {
  return validationErrorCodes.find((candidate) => candidate === code) ?? 'other'
}
