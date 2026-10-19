import { readFileSync } from 'node:fs'

import type { Fixture } from './fixtures'

const fixtureUrl = ({ path }: Pick<Fixture, 'path'>) => new URL(`../${path}`, import.meta.url)

export function readFixture(fixture: Pick<Fixture, 'path' | 'encoding'>): string {
  return new TextDecoder(fixture.encoding, { fatal: true }).decode(
    readFileSync(fixtureUrl(fixture)),
  )
}
