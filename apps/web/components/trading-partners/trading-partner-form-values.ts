import {
  acknowledgementTimeLimitHours,
  type CharacterSet,
  type TradingPartner,
  type TradingPartnerInput,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'

import { fieldErrors, type FormIssue, tooLongOr } from '../../lib/forms/field-errors'
import { type GlnError, glnError, normalizeGln } from '../../lib/forms/gln'

export type TradingPartnerFormValues = {
  name: string
  gln: string
  characterSet: CharacterSet
  acknowledgementTimeLimitHours: string
}

export type TradingPartnerField = keyof TradingPartnerFormValues

export type FieldError = 'required' | 'tooLong' | 'range' | GlnError

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
): TradingPartnerFormResult {
  const parsed = tradingPartnerInputSchema.safeParse({
    name: values.name,
    gln: normalizeGln(values.gln),
    characterSet: values.characterSet,
    acknowledgementTimeLimitHours: Number(values.acknowledgementTimeLimitHours),
  })

  if (parsed.success) {
    return { input: parsed.data }
  }

  return {
    errors: fieldErrors(parsed.error.issues, fields, (field, issue) =>
      fieldError(field, issue, values),
    ),
  }
}

export function toFormValues(tradingPartner?: TradingPartner): TradingPartnerFormValues {
  return {
    name: tradingPartner?.name ?? '',
    gln: tradingPartner?.gln ?? '',
    characterSet: tradingPartner?.characterSet ?? 'UNOC',
    acknowledgementTimeLimitHours: String(
      tradingPartner?.acknowledgementTimeLimitHours ?? acknowledgementTimeLimitHours.default,
    ),
  }
}
