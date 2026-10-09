import { hash } from './hash'

export function seedId(prefix: number, index: number) {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

export function stableUuid(key: string) {
  const hex = [1, 2, 3, 4]
    .map((round) =>
      hash(key, hash(String(round)))
        .toString(16)
        .padStart(8, '0'),
    )
    .join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
