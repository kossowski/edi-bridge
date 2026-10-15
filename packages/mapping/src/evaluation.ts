import { Effect } from 'effect'
import jsonata from 'jsonata'
import { z } from 'zod'

import {
  type ConditionOperator,
  type JsonContent,
  type LinkStart,
  type LookupTableEntry,
  type MappingTransform,
  transformPorts,
} from '@edi-bridge/contracts'

import { MappingError, type MappingErrorCode } from './errors'
import { reformatDate, reformatNumber } from './formats'

import type { Graph, LookupTables } from './wiring'

export type ApplyOptions = {
  lookupTables?: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>
}

export const valueSchema = z.union([z.string(), z.number(), z.boolean().transform(String)])

export type Value = z.infer<typeof valueSchema>

type Expressions = ReadonlyMap<string, string>

export type EvaluatedGraph = Graph & { expressions: Expressions }

export type Evaluation = {
  graph: EvaluatedGraph
  counters: ReadonlyMap<string, string>
  read: (sourcePath: string) => Value | undefined
  targetPath: string
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

function lookedUp(
  { config: { lookupTableId, fallback } }: Extract<MappingTransform, { kind: 'lookupTable' }>,
  value: string,
  lookupTables: LookupTables,
  fail: (code: MappingErrorCode) => MappingError,
): Effect.Effect<string, MappingError> {
  const table = lookupTableId === null ? undefined : lookupTables.get(lookupTableId)

  if (table === undefined) {
    return Effect.fail(fail('unknownLookupTable'))
  }

  const found = table.get(value)

  if (value === '' || found !== undefined) {
    return Effect.succeed(found ?? '')
  }

  switch (fallback) {
    case 'keepValue':
      return Effect.succeed(value)
    case 'empty':
      return Effect.succeed('')
    case 'fail':
      return Effect.fail(fail('noLookupMatch'))
  }
}

function applied(
  transform: Exclude<MappingTransform, { kind: 'loop' | 'conditional' }>,
  args: Readonly<Record<string, Value>>,
  { expressions, lookupTables }: EvaluatedGraph,
  fail: (code: MappingErrorCode) => MappingError,
): Effect.Effect<string, MappingError> {
  const value = String(args.value ?? '')

  const formatted = (format: () => string | undefined, code: MappingErrorCode) => {
    const result = value === '' ? '' : format()

    return result === undefined ? Effect.fail(fail(code)) : Effect.succeed(result)
  }

  switch (transform.kind) {
    case 'constant':
      return Effect.succeed(transform.config.value)
    case 'concatenate':
      return Effect.succeed(
        transformPorts(transform)
          .inputs.map((input) => String(args[input] ?? ''))
          .filter((part) => part !== '')
          .join(transform.config.separator),
      )
    case 'split':
      return Effect.succeed(value.split(transform.config.separator)[transform.config.index] ?? '')
    case 'substring': {
      const { start, length } = transform.config

      return Effect.succeed(value.slice(start, length === null ? undefined : start + length))
    }

    case 'dateFormat':
      return formatted(
        () => reformatDate(value, transform.config.from, transform.config.to),
        'invalidDate',
      )
    case 'numberFormat':
      return formatted(
        () =>
          reformatNumber(
            args.value ?? '',
            transform.config.decimalPlaces,
            transform.config.decimalSeparator,
          ),
        'invalidNumber',
      )
    case 'lookupTable':
      return lookedUp(transform, value, lookupTables, fail)
    case 'jsonata': {
      const result = expressions.get(transform.id)

      return result === undefined ? Effect.fail(fail('expressionFailed')) : Effect.succeed(result)
    }
  }
}

function feedsOf(
  { feeding }: Pick<Graph, 'feeding'>,
  transform: MappingTransform,
): ReadonlyMap<string, LinkStart> {
  return new Map(
    transformPorts(transform).inputs.flatMap((input) => {
      const from = feeding.get(`${transform.id}/${input}`)

      return from ? [[input, from] as const] : []
    }),
  )
}

export function outputOf(
  evaluation: Evaluation,
  start: LinkStart,
  visiting: ReadonlySet<string> = new Set(),
): Effect.Effect<Value, MappingError> {
  if (start.kind === 'source') {
    return Effect.succeed(evaluation.read(start.path) ?? '')
  }

  const { graph, counters, targetPath } = evaluation
  const transform = graph.transforms.get(start.transformId)

  const fail = (code: MappingErrorCode, transformId: string) =>
    new MappingError({ code, targetPath, transformId })

  if (!transform || !graph.valid.has(transform.id) || visiting.has(transform.id)) {
    return Effect.fail(fail('invalidTransform', start.transformId))
  }

  if (transform.kind === 'loop') {
    return Effect.succeed(counters.get(transform.id) ?? '')
  }

  const inner = new Set(visiting).add(transform.id)
  const feeds = feedsOf(graph, transform)

  const inputOf = (input: string): Effect.Effect<Value, MappingError> => {
    const from = feeds.get(input)

    return from ? outputOf(evaluation, from, inner) : Effect.succeed('')
  }

  if (transform.kind === 'conditional') {
    const { operator, compareTo } = transform.config

    return Effect.flatMap(inputOf('value'), (value) =>
      inputOf(holds(operator, String(value), compareTo) ? 'then' : 'else'),
    )
  }

  return Effect.flatMap(
    Effect.forEach(feeds, ([input, from]) =>
      Effect.map(outputOf(evaluation, from, inner), (value): readonly [string, Value] => [
        input,
        value,
      ]),
    ),
    (args) =>
      applied(transform, Object.fromEntries(args), graph, (code) => fail(code, transform.id)),
  )
}

export function sourcePathsOf(
  graph: Pick<Graph, 'transforms' | 'feeding'>,
  start: LinkStart,
  visited = new Set<string>(),
): string[] {
  if (start.kind === 'source') {
    return [start.path]
  }

  const transform = graph.transforms.get(start.transformId)

  if (!transform || transform.kind === 'loop' || visited.has(transform.id)) {
    return []
  }

  visited.add(transform.id)

  return [...feedsOf(graph, transform).values()].flatMap((from) =>
    sourcePathsOf(graph, from, visited),
  )
}

export type SourceRead = { sourcePath: string; targetPath: string }

export const transformReads = (graph: Graph): SourceRead[] =>
  graph.targets.flatMap(({ path, from }) =>
    sourcePathsOf(graph, from).map((sourcePath) => ({ sourcePath, targetPath: path })),
  )

const resultSchema = z.union([z.string(), z.number(), z.boolean()]).optional()

async function resultOf(expression: string, source: JsonContent): Promise<string | undefined> {
  try {
    const result = resultSchema.safeParse(await jsonata(expression).evaluate(source))

    return result.success ? String(result.data ?? '') : undefined
  } catch {
    return undefined
  }
}

// JSONata reads the whole source, so each expression runs once, before the scopes of the loops.
export function evaluated(graph: Graph, source: JsonContent): Effect.Effect<EvaluatedGraph> {
  return Effect.map(
    Effect.forEach([...graph.transforms.values()], (transform) =>
      transform.kind === 'jsonata'
        ? Effect.map(
            Effect.promise(() => resultOf(transform.config.expression, source)),
            (result) => (result === undefined ? [] : [[transform.id, result] as const]),
          )
        : Effect.succeed([]),
    ),
    (results) => ({ ...graph, expressions: new Map(results.flat()) }),
  )
}
