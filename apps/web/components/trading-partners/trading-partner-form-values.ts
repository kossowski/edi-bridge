import {
  acknowledgementTimeLimitHours,
  type CharacterSet,
  type TradingPartner,
  type TradingPartnerInput,
  tradingPartnerInputSchema,
} from '@edi-bridge/contracts'

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

function isField(key: PropertyKey | undefined): key is TradingPartnerField {
  return (
    key === 'name' ||
    key === 'gln' ||
    key === 'characterSet' ||
    key === 'acknowledgementTimeLimitHours'
  )
}

function fieldError(
  field: TradingPartnerField,
  issue: { code: string },
  values: TradingPartnerFormValues,
): FieldError {
  switch (field) {
    case 'name':
      return issue.code === 'too_big' ? 'tooLong' : 'required'
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

  const errors: Partial<Record<TradingPartnerField, FieldError>> = {}

  for (const issue of parsed.error.issues) {
    const field = issue.path[0]

    if (isField(field)) {
      errors[field] ??= fieldError(field, issue, values)
    }
  }

  return { errors }
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
