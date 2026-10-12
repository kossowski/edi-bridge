import type { CodeMeaning, LookupTableKind, SuggestedEntry } from '@edi-bridge/contracts'

const partnerCodeMeanings: Readonly<Record<LookupTableKind, ReadonlyMap<string, string>>> = {
  units: new Map([
    ['PCE', 'Piece'],
    ['KGM', 'Kilogram'],
    ['LTR', 'Litre'],
    ['PF', 'Pallet'],
    ['MTR', 'Metre'],
    ['CT', 'Carton'],
    ['PK', 'Package'],
    ['BX', 'Box'],
    ['BO', 'Bottle'],
    ['SET', 'Set'],
  ]),
  countries: new Map([
    ['DE', 'Germany'],
    ['AT', 'Austria'],
    ['CH', 'Switzerland'],
    ['PL', 'Poland'],
    ['NL', 'Netherlands'],
    ['FR', 'France'],
  ]),
  addresses: new Map(),
  other: new Map([
    ['S', 'Standard rate'],
    ['AA', 'Lower rate'],
    ['Z', 'Zero rated goods'],
  ]),
}

type OwnCodeHint = { meaning: string | null; suggestions: ReadonlyArray<string> }

const ownCodeHints: Readonly<Record<LookupTableKind, ReadonlyMap<string, OwnCodeHint>>> = {
  units: new Map([
    ['KRT', { meaning: 'carton', suggestions: ['CT', 'PK', 'BX'] }],
    ['BTL', { meaning: 'bottle', suggestions: ['BO', 'PCE'] }],
    ['SET', { meaning: 'set', suggestions: ['SET', 'PCE'] }],
  ]),
  countries: new Map([['Polen', { meaning: null, suggestions: ['PL'] }]]),
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

export function meaningOf(kind: LookupTableKind, code: string) {
  return partnerCodeMeanings[kind].get(code) ?? null
}

export function codeMeaningsOf(kind: LookupTableKind, codes: Iterable<string>): CodeMeaning[] {
  return [...new Set(codes)].flatMap((code) => {
    const meaning = meaningOf(kind, code)

    return meaning === null ? [] : [{ code, meaning }]
  })
}

export function hintFor(kind: LookupTableKind, code: string) {
  const hint = ownCodeHints[kind].get(code)

  return {
    meaning: hint?.meaning ?? null,
    suggestions: codeMeaningsOf(kind, hint?.suggestions ?? []),
  }
}

export function firstValuesOf(kind: LookupTableKind): SuggestedEntry[] {
  return firstValues[kind].map(([sourceCode, targetCode]) => ({
    sourceCode,
    targetCode,
    targetMeaning: meaningOf(kind, targetCode),
  }))
}
