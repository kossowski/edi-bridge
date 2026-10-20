import {
  codeMeaningOf,
  codeMeaningsOf,
  type Language,
  type LookupTableKind,
  type SuggestedEntry,
} from '@edi-bridge/contracts'

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

// Without AI a code is explained only when it is itself a known code, as the api does.
export function knownMeaningOf(kind: LookupTableKind, code: string, language: Language) {
  const meaning = codeMeaningOf(kind, code, language)

  return { meaning, suggestions: meaning === null ? [] : [{ code, meaning }] }
}

function ownCodeHintOf(kind: LookupTableKind, code: string, language: Language) {
  const hint = ownCodeHints[kind].get(code)

  if (!hint) {
    return null
  }

  return {
    meaning: hint.meansCode === null ? null : codeMeaningOf(kind, hint.meansCode, language),
    suggestions: codeMeaningsOf(kind, hint.suggestions, language),
  }
}

// The missing codes read keeps the own-code hints until the screen asks the AI for them.
export function hintFor(kind: LookupTableKind, code: string, language: Language) {
  return ownCodeHintOf(kind, code, language) ?? { meaning: null, suggestions: [] }
}

export function aiHintFor(kind: LookupTableKind, code: string, language: Language) {
  return ownCodeHintOf(kind, code, language) ?? knownMeaningOf(kind, code, language)
}

export function firstValuesOf(kind: LookupTableKind, language: Language): SuggestedEntry[] {
  return firstValues[kind].map(([sourceCode, targetCode]) => ({
    sourceCode,
    targetCode,
    targetMeaning: codeMeaningOf(kind, targetCode, language),
  }))
}
