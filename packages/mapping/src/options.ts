import type { LookupTableEntry } from '@edi-bridge/contracts'

export type ApplyOptions = {
  lookupTables?: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>
}
