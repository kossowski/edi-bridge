import {
  type LookupTableScopeInput,
  type LookupTableSummary,
  maxLookupTableNameLength,
} from '@edi-bridge/contracts'

import { scopeKey } from '../lookup-tables/lookup-table-scope'

function sameName(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

function shortened(name: string, length: number) {
  return name.length <= length ? name : `${name.slice(0, length - 1).trimEnd()}…`
}

function numbered(base: string, number: number) {
  if (number === 1) {
    return shortened(base, maxLookupTableNameLength)
  }

  const suffix = ` (${number})`

  return `${shortened(base, maxLookupTableNameLength - suffix.length)}${suffix}`
}

export function namesFor(
  tables: ReadonlyArray<Pick<LookupTableSummary, 'name' | 'scope'>>,
  scope: LookupTableScopeInput,
) {
  return tables.flatMap((table) => (scopeKey(table.scope) === scopeKey(scope) ? [table.name] : []))
}

export function uniqueListName(base: string, taken: ReadonlyArray<string>) {
  let number = 1

  while (taken.some((name) => sameName(name, numbered(base, number)))) {
    number += 1
  }

  return numbered(base, number)
}
