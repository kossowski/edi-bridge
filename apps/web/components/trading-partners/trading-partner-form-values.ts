import {
  acknowledgementTimeLimitHours,
  type CharacterSet,
  glnIssue,
  type GlnIssue,
  type TradingPartner,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'

export type TradingPartnerFormValues = {
  name: string
  gln: string
  characterSet: CharacterSet
  acknowledgementTimeLimitHours: string
}

export type TradingPartnerField = keyof TradingPartnerFormValues

export type FieldError = 'required' | 'tooLong' | 'range' | GlnIssue

export type TradingPartnerFormResult =
  { input: TradingPartnerInput } | { errors: Partial<Record<TradingPartnerField, FieldError>> }

const maxNameLength = 70

export function normalizeGln(value: string) {
  return value.replaceAll(/\s/g, '')
}

export function glnError(value: string): FieldError | null {
  const gln = normalizeGln(value)

  return gln === '' ? 'required' : glnIssue(gln)
}

function hoursError(value: string) {
  const hours = Number(value)

  return /^\d+$/.test(value.trim()) &&
    hours >= acknowledgementTimeLimitHours.min &&
    hours <= acknowledgementTimeLimitHours.max
    ? null
    : 'range'
}

export function validateTradingPartnerForm(
  values: TradingPartnerFormValues,
): TradingPartnerFormResult {
  const name = values.name.trim()

  const found: ReadonlyArray<[TradingPartnerField, FieldError | null]> = [
    ['name', name === '' ? 'required' : name.length > maxNameLength ? 'tooLong' : null],
    ['gln', glnError(values.gln)],
    ['acknowledgementTimeLimitHours', hoursError(values.acknowledgementTimeLimitHours)],
  ]

  const errors = Object.fromEntries(found.filter(([, error]) => error !== null))

  if (Object.keys(errors).length > 0) {
    return { errors }
  }

  return {
    input: {
      name,
      gln: normalizeGln(values.gln),
      characterSet: values.characterSet,
      acknowledgementTimeLimitHours: Number(values.acknowledgementTimeLimitHours),
    },
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
