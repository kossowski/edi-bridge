import { en, Faker } from '@faker-js/faker'

import { hash } from './hash'

export function seededFaker(key: string) {
  return new Faker({ locale: [en], seed: hash(key) })
}
