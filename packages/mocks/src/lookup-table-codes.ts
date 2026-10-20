import {
  type CodeMeaning,
  codeMeaningOf,
  type Language,
  type LookupTableKind,
  type SuggestedEntry,
} from '@edi-bridge/contracts'

// The shared dictionary knows no list for this kind; the seed tables use UNCL 5305 tax categories.
const otherMeanings: ReadonlyMap<string, Readonly<Record<Language, string>>> = new Map([
  ['S', { en: 'Standard rate', de: 'Normalsatz' }],
  ['AA', { en: 'Lower rate', de: 'Ermäßigter Satz' }],
  ['Z', { en: 'Zero rated goods', de: 'Nullsatz' }],
])

// An own code means what its partner code means, so its meaning follows the language.
type OwnCodeHint = { meansCode: string | null; suggestions: ReadonlyArray<string> }

const ownCodeHints: Readonly<Record<LookupTableKind, ReadonlyMap<string, OwnCodeHint>>> = {
  units: new Map([
    ['KRT', { meansCode: 'CT', suggestions: ['CT', 'PK', 'BX'] }],
    ['BTL', { meansCode: 'BO', suggestions: ['BO', 'PCE'] }],
    ['SET', { meansCode: 'SET', suggestions: ['SET', 'PCE'] }],
  ]),
  countries: new Map([['Polen', { meansCode: null, suggestions: ['PL'] }]]),
  addresses: new Map(),
  other: new Map(),
}

const firstValues: Readonly<Record<LookupTableKind, ReadonlyArray<readonly [string, string]>>> = {
  units: [
    ['ST', 'PCE'],
    ['KRT', 'CT'],
    ['KG', 'KGM'],
    ['PAL', 'PF'],
  ],
  countries: [
    ['Deutschland', 'DE'],
    ['Österreich', 'AT'],
    ['Niederlande', 'NL'],
    ['Frankreich', 'FR'],
  ],
  addresses: [],
  other: [],
}

export function meaningOf(kind: LookupTableKind, code: string, language: Language) {
  return kind === 'other'
    ? (otherMeanings.get(code)?.[language] ?? null)
    : codeMeaningOf(kind, code, language)
}

export function codeMeaningsOf(
  kind: LookupTableKind,
  codes: Iterable<string>,
  language: Language,
): CodeMeaning[] {
  return [...new Set(codes)].flatMap((code) => {
    const meaning = meaningOf(kind, code, language)

    return meaning === null ? [] : [{ code, meaning }]
  })
}

export function hintFor(kind: LookupTableKind, code: string, language: Language) {
  const hint = ownCodeHints[kind].get(code)
  const meansCode = hint?.meansCode ?? null

  return {
    meaning: meansCode === null ? null : meaningOf(kind, meansCode, language),
    suggestions: codeMeaningsOf(kind, hint?.suggestions ?? [], language),
  }
}

export function firstValuesOf(kind: LookupTableKind, language: Language): SuggestedEntry[] {
  return firstValues[kind].map(([sourceCode, targetCode]) => ({
    sourceCode,
    targetCode,
    targetMeaning: meaningOf(kind, targetCode, language),
  }))
}
