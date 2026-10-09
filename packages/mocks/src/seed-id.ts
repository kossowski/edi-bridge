import { en, Faker } from '@faker-js/faker'

export function seedId(prefix: number, index: number) {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function hash(key: string, basis = 0x811c9dc5) {
  let value = basis

  for (let index = 0; index < key.length; index++) {
    value = Math.imul(value ^ key.charCodeAt(index), 0x01000193)
  }

  return value >>> 0
}

export function seededFaker(key: string) {
  return new Faker({ locale: [en], seed: hash(key) })
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

export function withCheckDigit(digits: string) {
  const sum = [...digits]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)

  return `${digits}${(10 - (sum % 10)) % 10}`
}
