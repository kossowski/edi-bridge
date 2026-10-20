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

export function hintFor(kind: LookupTableKind, code: string, language: Language) {
  const hint = ownCodeHints[kind].get(code)
  const meansCode = hint?.meansCode ?? null

  return {
    meaning: meansCode === null ? null : codeMeaningOf(kind, meansCode, language),
    suggestions: codeMeaningsOf(kind, hint?.suggestions ?? [], language),
  }
}

export function firstValuesOf(kind: LookupTableKind, language: Language): SuggestedEntry[] {
  return firstValues[kind].map(([sourceCode, targetCode]) => ({
    sourceCode,
    targetCode,
    targetMeaning: codeMeaningOf(kind, targetCode, language),
  }))
}
