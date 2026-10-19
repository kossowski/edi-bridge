import { Effect, Result } from 'effect'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { inferDocumentStructure, mappingVersionSchema, toEncodedFile } from '@edi-bridge/contracts'
import {
  type Interchange,
  type Message,
  parse,
  ParseError,
  validate,
  ValidationError,
} from '@edi-bridge/edifact'
import { applyMappingVersion, readDocument } from '@edi-bridge/mapping'

import { type Fixture, type FixtureFailure, fixtures, readFixture } from './index'

const require = createRequire(import.meta.url)

const mappingGolden = (name: string) =>
  readFileSync(require.resolve(`@edi-bridge/mapping/golden/${name}`), 'utf8')

const invoiceStructure = inferDocumentStructure({
  kind: 'jsonDocument',
  document: toEncodedFile(
    'invoic-reference.document.json',
    mappingGolden('invoic-reference.document.json'),
  ),
})

const invoiceVersion = mappingVersionSchema.parse(
  JSON.parse(mappingGolden('invoic-reference.mapping.json')),
)

// The entries of the Lookup Table that the golden test of packages/mapping gives the reference Mapping Version.
const unitTable = {
  id: '2b7c4e91-5d3a-4f8e-b6c2-9a1d0e3f4b57',
  entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
}

// Without a reference Mapping for DESADV, the dispatch Document Structure comes from the first valid sample.
const dispatchSample = fixtures.find(({ format, valid }) => format === 'csv' && valid)

if (dispatchSample === undefined) {
  throw new Error('The index holds no valid dispatch CSV')
}

const dispatchStructure = inferDocumentStructure({
  kind: 'csvDocument',
  document: toEncodedFile('dispatch.csv', readFixture(dispatchSample), 'windows-1252'),
  csv: { delimiter: ';', headerRow: true, encoding: 'windows-1252' },
})

const framed = (message: Message): Interchange => ({
  hasServiceStringAdvice: false,
  delimiters: {
    component: ':',
    element: '+',
    decimal: '.',
    release: '?',
    repetition: ' ',
    segment: "'",
  },
  header: { tag: 'UNB', elements: [] },
  messages: [message],
  trailer: { tag: 'UNZ', elements: [] },
})

function edifactOutcome(text: string): FixtureFailure | null {
  try {
    validate(parse(text))

    return null
  } catch (error) {
    if (error instanceof ParseError) {
      return { stage: 'parse', code: error.code }
    }

    if (error instanceof ValidationError) {
      return { stage: 'validation', code: error.code }
    }

    throw error
  }
}

async function invoiceOutcome(text: string): Promise<FixtureFailure | null> {
  if (invoiceVersion.direction !== 'outbound') {
    throw new Error('The reference invoice Mapping Version is not outbound')
  }

  const mapped = await Effect.runPromise(
    Effect.result(
      Effect.flatMap(readDocument(invoiceStructure, text), (document) =>
        applyMappingVersion(invoiceVersion, document, {
          lookupTables: new Map([[unitTable.id, unitTable.entries]]),
        }),
      ),
    ),
  )

  if (Result.isFailure(mapped)) {
    return { stage: 'mapping', code: mapped.failure.code }
  }

  try {
    validate(framed(mapped.success))

    return null
  } catch (error) {
    if (error instanceof ValidationError) {
      return { stage: 'validation', code: error.code }
    }

    throw error
  }
}

async function dispatchOutcome(text: string): Promise<FixtureFailure | null> {
  const read = await Effect.runPromise(Effect.result(readDocument(dispatchStructure, text)))

  return Result.isFailure(read) ? { stage: 'mapping', code: read.failure.code } : null
}

function outcomeOf(fixture: Fixture) {
  const text = readFixture(fixture)

  switch (fixture.format) {
    case 'edifact':
      return edifactOutcome(text)
    case 'json':
      return invoiceOutcome(text)
    case 'csv':
      return dispatchOutcome(text)
  }
}

describe('the fixture index', () => {
  it('lists every Document in documents/ exactly once', () => {
    const files = ['valid', 'broken'].flatMap((folder) =>
      readdirSync(new URL(`../documents/${folder}`, import.meta.url)).map(
        (name) => `documents/${folder}/${name}`,
      ),
    )

    expect(fixtures.map(({ path }) => path).toSorted()).toEqual(files.toSorted())
  })

  it('keeps each Document in the folder of its outcome', () => {
    for (const fixture of fixtures) {
      expect(fixture.path).toMatch(fixture.valid ? /^documents\/valid\// : /^documents\/broken\//)
    }
  })

  it('holds valid and broken Documents of each format', () => {
    for (const format of ['edifact', 'json', 'csv']) {
      const ofFormat = fixtures.filter((fixture) => fixture.format === format)

      expect(ofFormat.some(({ valid }) => valid)).toBe(true)
      expect(ofFormat.some(({ valid }) => !valid)).toBe(true)
    }
  })
})

describe.each(fixtures.map((fixture) => ({ ...fixture, name: fixture.path })))(
  '$name',
  (fixture) => {
    it(fixture.valid ? 'passes every stage' : `fails at ${fixture.failure.stage}`, async () => {
      expect(await outcomeOf(fixture)).toEqual(fixture.valid ? null : fixture.failure)
    })

    it('decodes in its encoding', () => {
      expect(() => readFixture(fixture)).not.toThrow()
    })
  },
)

const checkDigitHolds = (digits: string) => {
  const sum = [...digits.slice(0, -1)]
    .toReversed()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)

  return (10 - (sum % 10)) % 10 === Number(digits.at(-1))
}

describe('the GS1 numbers', () => {
  const numbers = fixtures.flatMap((fixture) =>
    [...readFixture(fixture).matchAll(/(?<!\d)(\d{13}|\d{18})(?!\d)/g)].map(([digits]) => ({
      path: fixture.path,
      digits,
    })),
  )

  it('come from the restricted prefixes 020 to 029', () => {
    expect(numbers.length).toBeGreaterThan(0)

    for (const { path, digits } of numbers) {
      const prefix = digits.length === 18 ? digits.slice(1, 4) : digits.slice(0, 3)

      expect(prefix, `${digits} in ${path}`).toMatch(/^02\d$/)
    }
  })

  it('carry a valid check digit', () => {
    for (const { path, digits } of numbers) {
      expect(checkDigitHolds(digits), `${digits} in ${path}`).toBe(true)
    }
  })
})
