import { type CharacterEncoding, type EncodedFile, toEncodedFile } from '@edi-bridge/contracts'

import { seededFaker } from './seeded-faker'

export function createCsvDocument({
  rowCount,
  encoding = 'utf-8',
  seed = 'csv',
}: {
  rowCount: number
  encoding?: CharacterEncoding
  seed?: string
}): EncodedFile {
  const faker = seededFaker(`${seed}:${rowCount}`)
  const cities = ['München', 'Köln', 'Düsseldorf', 'Nürnberg', 'Lübeck', 'Würzburg', 'Göttingen']

  const rows = Array.from({ length: rowCount }, (_, index) =>
    [
      `LS-${90_000 + Math.floor(index / 8)}`,
      `${String(faker.number.int({ min: 1, max: 28 })).padStart(2, '0')}.10.2026`,
      faker.company.name().replaceAll(';', ''),
      faker.helpers.arrayElement(cities),
      `0${faker.string.numeric(13)}`,
      String(faker.number.int({ min: 1, max: 500 })),
      faker.datatype.boolean({ probability: 0.2 }) ? 'Kühlware' : '',
    ].join(';'),
  )

  return toEncodedFile(
    `lieferscheine-${rowCount}.csv`,
    ['Lieferscheinnummer;Lieferdatum;Kunde;Ort;GTIN;Menge;Bemerkung', ...rows].join('\r\n'),
    encoding,
  )
}
