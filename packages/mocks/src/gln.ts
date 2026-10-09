import type { Faker } from '@faker-js/faker'

import { withCheckDigit } from '@edi-bridge/contracts'

export function randomGln(faker: Faker) {
  return withCheckDigit(`02${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`)
}
