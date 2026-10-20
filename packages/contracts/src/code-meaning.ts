import { z } from 'zod'

import type { CodeMeaning, LookupTableKind } from './lookup-table'

export const languages = ['en', 'de'] as const

export const languageSchema = z.enum(languages)

export type Language = z.infer<typeof languageSchema>

export const defaultLanguage: Language = 'en'

export const languageQuerySchema = z.object({ language: languageSchema.default(defaultLanguage) })

export type LanguageQuery = z.input<typeof languageQuerySchema>

type Meanings = Readonly<Record<Language, string>>

export const standardListOf: Readonly<Record<LookupTableKind, string>> = {
  units: 'unit codes of UN/ECE Recommendation 20, such as PCE or KGM',
  countries: 'country codes of ISO 3166-1 alpha-2, such as DE or NL',
  addresses: 'address identifiers such as GLNs',
  other: 'tax category codes of UNCL 5305, such as S or AA',
}

// Partners send package codes such as CT as units, so they stand among the UN/ECE unit codes.
const unitMeanings: ReadonlyMap<string, Meanings> = new Map([
  ['PCE', { en: 'Piece', de: 'Stück' }],
  ['H87', { en: 'Piece', de: 'Stück' }],
  ['C62', { en: 'One', de: 'Eins' }],
  ['SET', { en: 'Set', de: 'Satz' }],
  ['PR', { en: 'Pair', de: 'Paar' }],
  ['DZN', { en: 'Dozen', de: 'Dutzend' }],
  ['KGM', { en: 'Kilogram', de: 'Kilogramm' }],
  ['GRM', { en: 'Gram', de: 'Gramm' }],
  ['TNE', { en: 'Tonne', de: 'Tonne' }],
  ['LTR', { en: 'Litre', de: 'Liter' }],
  ['MLT', { en: 'Millilitre', de: 'Milliliter' }],
  ['MTR', { en: 'Metre', de: 'Meter' }],
  ['CMT', { en: 'Centimetre', de: 'Zentimeter' }],
  ['MMT', { en: 'Millimetre', de: 'Millimeter' }],
  ['KMT', { en: 'Kilometre', de: 'Kilometer' }],
  ['MTK', { en: 'Square metre', de: 'Quadratmeter' }],
  ['MTQ', { en: 'Cubic metre', de: 'Kubikmeter' }],
  ['MIN', { en: 'Minute', de: 'Minute' }],
  ['HUR', { en: 'Hour', de: 'Stunde' }],
  ['DAY', { en: 'Day', de: 'Tag' }],
  ['KWH', { en: 'Kilowatt hour', de: 'Kilowattstunde' }],
  ['CT', { en: 'Carton', de: 'Karton' }],
  ['PK', { en: 'Package', de: 'Packung' }],
  ['BX', { en: 'Box', de: 'Kiste' }],
  ['BO', { en: 'Bottle', de: 'Flasche' }],
  ['PF', { en: 'Pallet', de: 'Palette' }],
])

// The kind other has no list of its own; tax categories (UNCL 5305) are its common codes.
const otherMeanings: ReadonlyMap<string, Meanings> = new Map([
  ['S', { en: 'Standard rate', de: 'Normalsatz' }],
  ['AA', { en: 'Lower rate', de: 'Ermäßigter Satz' }],
  ['Z', { en: 'Zero rated goods', de: 'Nullsatz' }],
])

// ISO 3166-1 alpha-2; Intl.DisplayNames also names regions such as EU that are no country.
const countryCodes = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
    'BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
    'EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW ' +
    'GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY ' +
    'KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV ' +
    'MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY ' +
    'QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG ' +
    'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' '),
)

const countryNames: Readonly<Record<Language, Intl.DisplayNames>> = {
  en: new Intl.DisplayNames('en', { type: 'region' }),
  de: new Intl.DisplayNames('de', { type: 'region' }),
}

export function codeMeaningOf(kind: LookupTableKind, code: string, language: Language) {
  switch (kind) {
    case 'units':
      return unitMeanings.get(code)?.[language] ?? null
    case 'countries':
      return countryCodes.has(code) ? (countryNames[language].of(code) ?? null) : null
    case 'other':
      return otherMeanings.get(code)?.[language] ?? null
    case 'addresses':
      return null
  }
}

export function codeMeaningsOf(
  kind: LookupTableKind,
  codes: Iterable<string>,
  language: Language,
): CodeMeaning[] {
  return [...new Set(codes)].flatMap((code) => {
    const meaning = codeMeaningOf(kind, code, language)

    return meaning === null ? [] : [{ code, meaning }]
  })
}
