import {
  acknowledgementTimeLimitHours,
  type CharacterSet,
  glnRequired,
  type TradingPartner,
  type TradingPartnerInput,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'

import { fieldErrors, type FormIssue, tooLongOr } from '../../lib/forms/field-errors'
import { type GlnError, glnError, normalizeGln } from '../../lib/forms/gln'

export const defaultCharacterSet: CharacterSet = 'UNOC'

export type TradingPartnerFormValues = {
  name: string
  gln: string
  characterSet: CharacterSet
  acknowledgementTimeLimitHours: string
}

export type TradingPartnerField = keyof TradingPartnerFormValues

export type FieldError = 'required' | 'tooLong' | 'range' | 'stillNeeded' | GlnError

export type TradingPartnerFormResult =
  { input: TradingPartnerInput } | { errors: Partial<Record<TradingPartnerField, FieldError>> }

const fields = [
  'name',
  'gln',
  'characterSet',
  'acknowledgementTimeLimitHours',
] as const satisfies ReadonlyArray<TradingPartnerField>

function fieldError(
  field: TradingPartnerField,
  issue: FormIssue,
  values: TradingPartnerFormValues,
): FieldError {
  switch (field) {
    case 'name':
      return tooLongOr(issue, 'required')
    case 'gln':
      return glnError(values.gln) ?? 'format'
    case 'characterSet':
      return 'required'
    case 'acknowledgementTimeLimitHours':
      return 'range'
  }
}

export function validateTradingPartnerForm(
  values: TradingPartnerFormValues,
  tradingPartner?: TradingPartner,
): TradingPartnerFormResult {
  const gln = normalizeGln(values.gln) || null

  const parsed = tradingPartnerInputSchema.safeParse({
    name: values.name,
    gln,
    characterSet: values.characterSet,
    acknowledgementTimeLimitHours: Number(values.acknowledgementTimeLimitHours),
  })

  const stillNeeded = gln === null && tradingPartner !== undefined && glnRequired(tradingPartner)

  if (parsed.success && !stillNeeded) {
    return { input: parsed.data }
  }

  const errors: Partial<Record<TradingPartnerField, FieldError>> = parsed.success
    ? {}
    : fieldErrors(parsed.error.issues, fields, (field, issue) => fieldError(field, issue, values))

  return {
    errors: Object.fromEntries(
      fields.flatMap((field): Array<[TradingPartnerField, FieldError]> => {
        const error = field === 'gln' && stillNeeded ? 'stillNeeded' : errors[field]

        return error ? [[field, error]] : []
      }),
    ),
  }
}

export function toFormValues(tradingPartner?: TradingPartner): TradingPartnerFormValues {
  return {
    name: tradingPartner?.name ?? '',
    gln: tradingPartner?.gln ?? '',
    characterSet: tradingPartner?.characterSet ?? defaultCharacterSet,
    acknowledgementTimeLimitHours: String(
      tradingPartner?.acknowledgementTimeLimitHours ?? acknowledgementTimeLimitHours.default,
    ),
  }
}
