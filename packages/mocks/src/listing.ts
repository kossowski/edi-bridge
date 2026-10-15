export type Listing<T> = ReadonlyArray<T> | { all: () => readonly T[] }

export function allOf<T>(listing: Listing<T>): readonly T[] {
  return 'all' in listing ? listing.all() : listing
}
