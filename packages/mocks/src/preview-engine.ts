import jsonata from 'jsonata'
import { z } from 'zod'

import {
  type ConditionOperator,
  type JsonContent,
  jsonContentSchema,
  type LinkStart,
  type MappingGraph,
  type MappingTransform,
  type PreviewNote,
  type PreviewNoteCode,
  transformIssues,
  transformPorts,
} from '@edi-bridge/contracts'

import { type DocumentValues, type Entry } from './document-values'
import { seedLookupTables } from './lookup-table'

// A rough stand-in for the mapping engine of tickets 27 and 28: enough to show what a change does
// to the target Document, not a faithful execution of the Mapping.

type Value = { at: ReadonlyArray<number>; value: string }

type Outcome =
  | { ok: true; values: ReadonlyArray<Value> }
  | { ok: false; transformId: string | null; code: PreviewNoteCode }

const ok = (values: ReadonlyArray<Value>): Outcome => ({ ok: true, values })

const failed = (transformId: string | null, code: PreviewNoteCode): Outcome => ({
  ok: false,
  transformId,
  code,
})

// A few rows per seed Lookup Table; ticket 14 brings the real entries.
const lookupRows = new Map([
  [
    'Units of measure',
    new Map([
      ['ST', 'PCE'],
      ['STK', 'PCE'],
      ['KG', 'KGM'],
      ['L', 'LTR'],
    ]),
  ],
  [
    'Country codes',
    new Map([
      ['Deutschland', 'DE'],
      ['Österreich', 'AT'],
      ['Schweiz', 'CH'],
    ]),
  ],
  [
    'VAT categories',
    new Map([
      ['19', 'S'],
      ['7', 'AA'],
      ['0', 'Z'],
    ]),
  ],
  [
    'Hansemarkt units',
    new Map([
      ['ST', 'PCE'],
      ['KAR', 'CT'],
    ]),
  ],
])

function lookUp(lookupTableId: string | null, value: string) {
  const table = seedLookupTables.find(({ id }) => id === lookupTableId)

  return table ? lookupRows.get(table.name)?.get(value) : undefined
}

const dateTokens = ['yyyy', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss'] as const

const isDateToken = (part: string) => dateTokens.some((token) => token === part)

function tokensOf(pattern: string) {
  return pattern.split(new RegExp(`(${dateTokens.join('|')})`)).filter((part) => part !== '')
}

function reformatDate(value: string, from: string, to: string) {
  const parts: Record<string, string> = {}
  let rest = value

  for (const token of tokensOf(from)) {
    if (!isDateToken(token)) {
      if (!rest.startsWith(token)) {
        return value
      }

      rest = rest.slice(token.length)
      continue
    }

    parts[token] = rest.slice(0, token.length)
    rest = rest.slice(token.length)
  }

  if (parts.yyyy === undefined && parts.yy !== undefined) {
    parts.yyyy = `20${parts.yy}`
  }

  if (parts.yy === undefined && parts.yyyy !== undefined) {
    parts.yy = parts.yyyy.slice(2)
  }

  return tokensOf(to)
    .map((token) => parts[token] ?? (isDateToken(token) ? '00' : token))
    .join('')
}

function reformatNumber(value: string, places: number | null, separator: string) {
  const number = Number(value.replace(',', '.'))

  if (value.trim() === '' || isNaN(number)) {
    return value
  }

  return (places === null ? String(number) : number.toFixed(places)).replace('.', separator)
}

function holds(operator: ConditionOperator, value: string, compareTo: string) {
  switch (operator) {
    case 'equals':
      return value === compareTo
    case 'notEquals':
      return value !== compareTo
    case 'contains':
      return value.includes(compareTo)
    case 'isEmpty':
      return value === ''
    case 'isNotEmpty':
      return value !== ''
  }
}

function applyTransform(
  transform: MappingTransform,
  args: Readonly<Record<string, string>>,
): string | undefined {
  const value = args.value ?? ''

  switch (transform.kind) {
    case 'concatenate':
      return transformPorts(transform)
        .inputs.map((input) => args[input] ?? '')
        .join(transform.config.separator)
    case 'split':
      return value.split(transform.config.separator)[transform.config.index] ?? ''
    case 'substring': {
      const { start, length } = transform.config

      return value.slice(start, length === null ? undefined : start + length)
    }

    case 'dateFormat':
      return reformatDate(value, transform.config.from, transform.config.to)
    case 'numberFormat':
      return reformatNumber(
        value,
        transform.config.decimalPlaces,
        transform.config.decimalSeparator,
      )
    case 'lookupTable': {
      const found = lookUp(transform.config.lookupTableId, value)

      if (found !== undefined) {
        return found
      }

      return { keepValue: value, empty: '', fail: undefined }[transform.config.fallback]
    }

    case 'conditional':
      return holds(transform.config.operator, value, transform.config.compareTo)
        ? (args.then ?? '')
        : (args.else ?? '')
    default:
      return value
  }
}

function compatible(a: ReadonlyArray<number>, b: ReadonlyArray<number>) {
  return a.slice(0, Math.min(a.length, b.length)).every((index, position) => index === b[position])
}

// The repetitions of a part, e.g. each line beneath `lines[]`, numbered from `counterStart`.
function counters(values: DocumentValues, part: string, counterStart: number): Value[] {
  const entries = values.beneath(part)

  if (entries.length === 0) {
    return []
  }

  const depth = Math.min(...entries.map(({ at }) => at.length))
  const items = new Map(entries.map(({ at }) => [at.slice(0, depth).join('/'), at.slice(0, depth)]))

  return [...items.values()].map((at) => ({
    at,
    value: String((at.at(-1) ?? 0) + counterStart),
  }))
}

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

function text(value: JsonContent) {
  const scalar = scalarSchema.safeParse(value)

  return scalar.success ? String(scalar.data) : JSON.stringify(value)
}

export type ExpressionResults = ReadonlyMap<string, Outcome>

// JSONata reads the whole source Document, which the mock has as JSON only on the ERP side.
export async function evaluateExpressions(
  graph: Pick<MappingGraph, 'transforms'>,
  source: JsonContent | undefined,
): Promise<ExpressionResults> {
  const results = new Map<string, Outcome>()

  for (const transform of graph.transforms) {
    if (transform.kind !== 'jsonata') {
      continue
    }

    if (source === undefined) {
      results.set(transform.id, failed(transform.id, 'expressionNotPreviewed'))
      continue
    }

    try {
      const result = jsonContentSchema
        .optional()
        .safeParse(await jsonata(transform.config.expression).evaluate(source))

      if (!result.success) {
        results.set(transform.id, failed(transform.id, 'expressionFailed'))
        continue
      }

      const { data } = result
      const items = data === undefined ? [] : Array.isArray(data) ? data : [data]

      results.set(
        transform.id,
        ok(
          items.map((item, index) => ({
            at: Array.isArray(data) ? [index] : [],
            value: text(item),
          })),
        ),
      )
    } catch {
      results.set(transform.id, failed(transform.id, 'expressionFailed'))
    }
  }

  return results
}

export function previewEntries(
  graph: MappingGraph,
  values: DocumentValues,
  expressions: ExpressionResults,
) {
  const issues = transformIssues(graph)
  const byId = new Map(graph.transforms.map((transform) => [transform.id, transform]))

  const feeding = new Map(
    graph.transformLinks.flatMap(({ from, to }) =>
      to.kind === 'transform' ? [[`${to.transformId}/${to.input}`, from] as const] : [],
    ),
  )

  const outputOf = (start: LinkStart): Outcome => {
    if (start.kind === 'source') {
      return ok(values.entries(start.path))
    }

    const transform = byId.get(start.transformId)

    if (!transform || (issues[transform.id]?.length ?? 0) > 0) {
      return failed(start.transformId, 'invalidTransform')
    }

    switch (transform.kind) {
      case 'constant':
        return ok([{ at: [], value: transform.config.value }])
      case 'jsonata':
        return expressions.get(transform.id) ?? ok([])
      case 'loop': {
        const items = feeding.get(`${transform.id}/items`)

        return start.output === 'counter' && items?.kind === 'source'
          ? ok(counters(values, items.path, transform.config.counterStart))
          : ok([])
      }
    }

    const inputs: Array<readonly [string, ReadonlyArray<Value>]> = []

    for (const input of transformPorts(transform).inputs) {
      const from = feeding.get(`${transform.id}/${input}`)
      const outcome = from ? outputOf(from) : ok([])

      if (!outcome.ok) {
        return outcome
      }

      inputs.push([input, outcome.values])
    }

    // The deepest input sets the repetitions; shallower ones, such as a header field, repeat along.
    const driver = inputs
      .map(([, list]) => list)
      .reduce<ReadonlyArray<Value>>(
        (deepest, list) =>
          list.length > 0 &&
          (deepest.length === 0 ||
            Math.max(...list.map(({ at }) => at.length)) >
              Math.max(...deepest.map(({ at }) => at.length)))
            ? list
            : deepest,
        [],
      )

    const results: Value[] = []

    for (const { at } of driver) {
      const args = Object.fromEntries(
        inputs.map(([input, list]) => [
          input,
          list.find((candidate) => compatible(candidate.at, at))?.value ?? '',
        ]),
      )

      const value = applyTransform(transform, args)

      if (value === undefined) {
        return failed(transform.id, 'noLookupMatch')
      }

      results.push({ at, value })
    }

    return ok(results)
  }

  const targets: Array<readonly [string, LinkStart]> = [
    ...graph.links.map(
      ({ sourcePath, targetPath }) =>
        [targetPath, { kind: 'source', path: sourcePath } as const] as const,
    ),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      to.kind === 'target' ? [[to.path, from] as const] : [],
    ),
  ]

  const entries: Entry[] = []
  const notes: PreviewNote[] = []

  for (const [targetPath, start] of targets) {
    const outcome = outputOf(start)

    if (outcome.ok) {
      entries.push(...outcome.values.map(({ at, value }) => ({ path: targetPath, at, value })))
    } else {
      notes.push({ targetPath, transformId: outcome.transformId, code: outcome.code })
    }
  }

  return { entries, notes }
}
