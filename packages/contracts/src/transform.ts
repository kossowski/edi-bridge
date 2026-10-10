import jsonata from 'jsonata'
import { z } from 'zod'

export const transformKinds = [
  'constant',
  'concatenate',
  'split',
  'substring',
  'dateFormat',
  'numberFormat',
  'lookupTable',
  'conditional',
  'loop',
  'jsonata',
] as const

export type TransformKind = (typeof transformKinds)[number]

export const concatenateInputs = { min: 2, max: 10 } as const

export const decimalSeparators = ['.', ','] as const

export const lookupFallbacks = ['keepValue', 'empty', 'fail'] as const

export const conditionOperators = [
  'equals',
  'notEquals',
  'contains',
  'isEmpty',
  'isNotEmpty',
] as const

export type ConditionOperator = (typeof conditionOperators)[number]

// These say only what a Draft can hold; whether a configuration is usable is up to
// `transformConfigSchemas`, so a half-configured node can still be saved.
export const draftTransformConfigSchemas = {
  constant: z.object({ value: z.string() }),
  concatenate: z.object({
    inputCount: z.number().int().min(1).max(concatenateInputs.max),
    separator: z.string(),
  }),
  split: z.object({ separator: z.string(), index: z.number().int() }),
  substring: z.object({ start: z.number().int(), length: z.number().int().nullable() }),
  dateFormat: z.object({ from: z.string(), to: z.string() }),
  numberFormat: z.object({
    decimalPlaces: z.number().int().nullable(),
    decimalSeparator: z.enum(decimalSeparators),
  }),
  lookupTable: z.object({
    lookupTableId: z.uuid().nullable(),
    fallback: z.enum(lookupFallbacks),
  }),
  conditional: z.object({ operator: z.enum(conditionOperators), compareTo: z.string() }),
  loop: z.object({ counterStart: z.number().int() }),
  jsonata: z.object({ expression: z.string() }),
} as const satisfies Record<TransformKind, z.ZodObject>

export type TransformConfig<Kind extends TransformKind = TransformKind> = z.infer<
  (typeof draftTransformConfigSchemas)[Kind]
>

export const decimalPlaces = { min: 0, max: 6 } as const

export const transformIssueCodes = [
  'required',
  'outOfRange',
  'invalidPattern',
  'invalidExpression',
] as const

export type TransformIssueCode = (typeof transformIssueCodes)[number]

export type TransformIssue = { field: string; code: TransformIssueCode }

type Check<Config> = (config: Config) => ReadonlyArray<TransformIssue | false>

function checked<Config extends z.ZodObject>(draftConfig: Config, check: Check<z.infer<Config>>) {
  return draftConfig.superRefine((config, context) => {
    for (const issue of check(config)) {
      if (issue) {
        context.addIssue({ code: 'custom', path: [issue.field], message: issue.code })
      }
    }
  })
}

const blank = (value: string) => value.trim() === ''

const required = (field: string, value: string): TransformIssue | false =>
  blank(value) && { field, code: 'required' }

const atLeast = (field: string, value: number | null, min: number): TransformIssue | false =>
  value !== null && value < min && { field, code: 'outOfRange' }

// Date patterns use the tokens yyyy, yy, MM, dd, HH, mm and ss, e.g. `yyyyMMdd` for EDIFACT's
// format 102, and need at least a year, a month and a day.
function datePattern(field: string, pattern: string): TransformIssue | false {
  if (blank(pattern)) {
    return { field, code: 'required' }
  }

  const known = /^(yyyy|yy|MM|dd|HH|mm|ss|[-./: T])+$/.test(pattern)
  const complete = ['yy', 'MM', 'dd'].every((token) => pattern.includes(token))

  return !(known && complete) && { field, code: 'invalidPattern' }
}

function expression(field: string, value: string): TransformIssue | false {
  if (blank(value)) {
    return { field, code: 'required' }
  }

  try {
    jsonata(value)

    return false
  } catch {
    return { field, code: 'invalidExpression' }
  }
}

const comparing: ReadonlyArray<ConditionOperator> = ['equals', 'notEquals', 'contains']

// The single source of "invalid configuration": every issue names the config field it is about
// and a code the UI translates.
export const transformConfigSchemas = {
  constant: checked(draftTransformConfigSchemas.constant, ({ value }) => [
    value === '' && { field: 'value', code: 'required' },
  ]),
  concatenate: checked(draftTransformConfigSchemas.concatenate, ({ inputCount }) => [
    atLeast('inputCount', inputCount, concatenateInputs.min),
  ]),
  split: checked(draftTransformConfigSchemas.split, ({ separator, index }) => [
    separator === '' && { field: 'separator', code: 'required' },
    atLeast('index', index, 0),
  ]),
  substring: checked(draftTransformConfigSchemas.substring, ({ start, length }) => [
    atLeast('start', start, 0),
    atLeast('length', length, 1),
  ]),
  dateFormat: checked(draftTransformConfigSchemas.dateFormat, ({ from, to }) => [
    datePattern('from', from),
    datePattern('to', to),
  ]),
  numberFormat: checked(draftTransformConfigSchemas.numberFormat, ({ decimalPlaces: places }) => [
    places !== null &&
      (places < decimalPlaces.min || places > decimalPlaces.max) && {
        field: 'decimalPlaces',
        code: 'outOfRange',
      },
  ]),
  lookupTable: checked(draftTransformConfigSchemas.lookupTable, ({ lookupTableId }) => [
    lookupTableId === null && { field: 'lookupTableId', code: 'required' },
  ]),
  conditional: checked(draftTransformConfigSchemas.conditional, ({ operator, compareTo }) => [
    comparing.includes(operator) && required('compareTo', compareTo),
  ]),
  loop: checked(draftTransformConfigSchemas.loop, ({ counterStart }) => [
    atLeast('counterStart', counterStart, 0),
  ]),
  jsonata: checked(draftTransformConfigSchemas.jsonata, ({ expression: value }) => [
    expression('expression', value),
  ]),
} as const satisfies Record<TransformKind, z.ZodType>

export function transformConfigIssues(transform: MappingTransform): TransformIssue[] {
  const result = transformConfigSchemas[transform.kind].safeParse(transform.config)

  return result.success
    ? []
    : result.error.issues.flatMap(({ path, message }) => {
        const code = transformIssueCodes.find((known) => known === message)

        return code ? [{ field: String(path[0]), code }] : []
      })
}

const positionSchema = z.object({ x: z.number(), y: z.number() })

function transformOf<Kind extends TransformKind>(kind: Kind) {
  return z.object({
    id: z.uuid(),
    kind: z.literal(kind),
    position: positionSchema,
    config: draftTransformConfigSchemas[kind],
  })
}

export const mappingTransformSchema = z.discriminatedUnion('kind', [
  transformOf('constant'),
  transformOf('concatenate'),
  transformOf('split'),
  transformOf('substring'),
  transformOf('dateFormat'),
  transformOf('numberFormat'),
  transformOf('lookupTable'),
  transformOf('conditional'),
  transformOf('loop'),
  transformOf('jsonata'),
])

export type MappingTransform = z.infer<typeof mappingTransformSchema>

export type TransformPorts = { inputs: string[]; outputs: string[] }

const singleValue: TransformPorts = { inputs: ['value'], outputs: ['value'] }

// JSONata reads the whole source Document, so it takes no inputs; a loop repeats its target part
// once per item of the source part linked into it and counts the items, e.g. for LIN numbers.
export function transformPorts(transform: MappingTransform): TransformPorts {
  switch (transform.kind) {
    case 'constant':
    case 'jsonata':
      return { inputs: [], outputs: ['value'] }
    case 'concatenate':
      return {
        inputs: Array.from(
          { length: transform.config.inputCount },
          (_, index) => `part${index + 1}`,
        ),
        outputs: ['value'],
      }
    case 'conditional':
      return { inputs: ['value', 'then', 'else'], outputs: ['value'] }
    case 'loop':
      return { inputs: ['items'], outputs: ['items', 'counter'] }
    default:
      return singleValue
  }
}

export const linkStartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), path: z.string().min(1) }),
  z.object({ kind: z.literal('transform'), transformId: z.uuid(), output: z.string().min(1) }),
])

export type LinkStart = z.infer<typeof linkStartSchema>

export const linkEndSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('target'), path: z.string().min(1) }),
  z.object({ kind: z.literal('transform'), transformId: z.uuid(), input: z.string().min(1) }),
])

export type LinkEnd = z.infer<typeof linkEndSchema>

// A link straight from a source field to a target element is a plain Mapping link; transform
// links are the ones that start or end at a transform.
export const transformLinkSchema = z
  .object({ from: linkStartSchema, to: linkEndSchema })
  .refine(
    ({ from, to }) => from.kind === 'transform' || to.kind === 'transform',
    'A link between a source field and a target element is a plain link',
  )

export type TransformLink = z.infer<typeof transformLinkSchema>
