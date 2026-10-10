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

export const decimalPlaces = { min: 0, max: 6 } as const

export const transformIssueCodes = [
  'required',
  'outOfRange',
  'invalidPattern',
  'invalidExpression',
  'invalid',
  'unconnected',
] as const

export type TransformIssueCode = (typeof transformIssueCodes)[number]

export type TransformConfigIssue = {
  field: string
  code: Exclude<TransformIssueCode, 'unconnected'>
}

export type TransformInputIssue = { input: string; code: 'unconnected' }

export type TransformIssue = TransformConfigIssue | TransformInputIssue

export type TransformPorts = { inputs: string[]; outputs: string[] }

// `draft` says only what a Draft can hold; whether a configuration is usable is up to `check`,
// so a half-configured node can still be saved. Inputs not in `optionalInputs` count as
// unconnected when no link ends at them.
type KindSpec<Draft extends z.ZodObject> = {
  draft: Draft
  check(config: z.infer<Draft>): ReadonlyArray<TransformConfigIssue | false>
  ports(config: z.infer<Draft>): TransformPorts
  optionalInputs?: ReadonlyArray<string>
}

const kindSpec = <Draft extends z.ZodObject>(spec: KindSpec<Draft>) => spec

const blank = (value: string) => value.trim() === ''

const required = (field: string, value: string): TransformConfigIssue | false =>
  blank(value) && { field, code: 'required' }

const atLeast = (field: string, value: number | null, min: number): TransformConfigIssue | false =>
  value !== null && value < min && { field, code: 'outOfRange' }

// Date patterns use the tokens yyyy, yy, MM, dd, HH, mm and ss, e.g. `yyyyMMdd` for EDIFACT's
// format 102, and need at least a year, a month and a day.
function datePattern(field: string, pattern: string): TransformConfigIssue | false {
  if (blank(pattern)) {
    return { field, code: 'required' }
  }

  const known = /^(yyyy|yy|MM|dd|HH|mm|ss|[-./: T])+$/.test(pattern)
  const complete = ['yy', 'MM', 'dd'].every((token) => pattern.includes(token))

  return !(known && complete) && { field, code: 'invalidPattern' }
}

const jsonataErrorSchema = z.object({
  position: z.number(),
  message: z.string(),
  code: z.string().optional(),
  token: z.union([z.string(), z.number()]).optional(),
  value: z.union([z.string(), z.number()]).optional(),
})

// `code` is the parser's error code, e.g. S0203, so the message can be shown in the user's
// language; `token` and `value` fill its gaps, and `message` is the parser's own English text.
export type ExpressionSyntaxError = {
  position: number
  message: string
  code: string | null
  token: string | null
  value: string | null
}

// `position` counts the characters up to and including the token the parser stopped at.
export function expressionSyntaxError(expression: string): ExpressionSyntaxError | null {
  try {
    jsonata(expression)

    return null
  } catch (error) {
    const parsed = jsonataErrorSchema.safeParse(error)

    if (!parsed.success) {
      return { position: expression.length, message: '', code: null, token: null, value: null }
    }

    const { position, message, code, token, value } = parsed.data

    return {
      position,
      message,
      code: code ?? null,
      token: token === undefined ? null : String(token),
      value: value === undefined ? null : String(value),
    }
  }
}

function expression(field: string, value: string): TransformConfigIssue | false {
  if (blank(value)) {
    return { field, code: 'required' }
  }

  return expressionSyntaxError(value) !== null && { field, code: 'invalidExpression' }
}

export const operatorsWithOperand: ReadonlyArray<ConditionOperator> = [
  'equals',
  'notEquals',
  'contains',
]

const singleValue = (): TransformPorts => ({ inputs: ['value'], outputs: ['value'] })

const transformCatalogue = {
  constant: kindSpec({
    draft: z.object({ value: z.string() }),
    check: ({ value }) => [value === '' && { field: 'value', code: 'required' }],
    ports: () => ({ inputs: [], outputs: ['value'] }),
  }),
  concatenate: kindSpec({
    draft: z.object({
      inputCount: z.number().int().min(1).max(concatenateInputs.max),
      separator: z.string(),
    }),
    check: ({ inputCount }) => [atLeast('inputCount', inputCount, concatenateInputs.min)],
    ports: ({ inputCount }) => ({
      inputs: Array.from({ length: inputCount }, (_, index) => `part${index + 1}`),
      outputs: ['value'],
    }),
  }),
  split: kindSpec({
    draft: z.object({ separator: z.string(), index: z.number().int() }),
    check: ({ separator, index }) => [
      separator === '' && { field: 'separator', code: 'required' },
      atLeast('index', index, 0),
    ],
    ports: singleValue,
  }),
  substring: kindSpec({
    draft: z.object({ start: z.number().int(), length: z.number().int().nullable() }),
    check: ({ start, length }) => [atLeast('start', start, 0), atLeast('length', length, 1)],
    ports: singleValue,
  }),
  dateFormat: kindSpec({
    draft: z.object({ from: z.string(), to: z.string() }),
    check: ({ from, to }) => [datePattern('from', from), datePattern('to', to)],
    ports: singleValue,
  }),
  numberFormat: kindSpec({
    draft: z.object({
      decimalPlaces: z.number().int().nullable(),
      decimalSeparator: z.enum(decimalSeparators),
    }),
    check: ({ decimalPlaces: places }) => [
      places !== null &&
        (places < decimalPlaces.min || places > decimalPlaces.max) && {
          field: 'decimalPlaces',
          code: 'outOfRange',
        },
    ],
    ports: singleValue,
  }),
  lookupTable: kindSpec({
    draft: z.object({
      lookupTableId: z.uuid().nullable(),
      fallback: z.enum(lookupFallbacks),
    }),
    check: ({ lookupTableId }) => [
      lookupTableId === null && { field: 'lookupTableId', code: 'required' },
    ],
    ports: singleValue,
  }),
  // Without an `else` value the target stays empty when the condition does not hold.
  conditional: kindSpec({
    draft: z.object({ operator: z.enum(conditionOperators), compareTo: z.string() }),
    check: ({ operator, compareTo }) => [
      operatorsWithOperand.includes(operator) && required('compareTo', compareTo),
    ],
    ports: () => ({ inputs: ['value', 'then', 'else'], outputs: ['value'] }),
    optionalInputs: ['else'],
  }),
  // A loop scopes links: its `items` input takes a repeating source part, its `items` output a
  // repeating target part, and links between fields beneath those parts run once per item. The
  // counter numbers the items, e.g. for LIN.
  loop: kindSpec({
    draft: z.object({ counterStart: z.number().int() }),
    check: ({ counterStart }) => [atLeast('counterStart', counterStart, 0)],
    ports: () => ({ inputs: ['items'], outputs: ['items', 'counter'] }),
  }),
  // JSONata reads the whole source Document, so it takes no inputs.
  jsonata: kindSpec({
    draft: z.object({ expression: z.string() }),
    check: ({ expression: value }) => [expression('expression', value)],
    ports: () => ({ inputs: [], outputs: ['value'] }),
  }),
}

type Catalogue = typeof transformCatalogue

// SAFETY: the entries come from `transformKinds`, so every kind gets its own catalogue schema.
export const draftTransformConfigSchemas = Object.fromEntries(
  transformKinds.map((kind) => [kind, transformCatalogue[kind].draft]),
) as { [Kind in TransformKind]: Catalogue[Kind]['draft'] }

export type TransformConfig<Kind extends TransformKind = TransformKind> = z.infer<
  (typeof draftTransformConfigSchemas)[Kind]
>

function specOf(kind: TransformKind): KindSpec<z.ZodObject> {
  return transformCatalogue[kind]
}

function checked<Draft extends z.ZodObject>(spec: KindSpec<Draft>) {
  return spec.draft.superRefine((config, context) => {
    for (const issue of spec.check(config)) {
      if (issue) {
        context.addIssue({ code: 'custom', path: [issue.field], params: { issue: issue.code } })
      }
    }
  })
}

// SAFETY: as above; `superRefine` keeps the schema's type, it only adds checks.
export const transformConfigSchemas = Object.fromEntries(
  transformKinds.map((kind) => [kind, checked(specOf(kind))]),
) as typeof draftTransformConfigSchemas

const configIssueCodes = transformIssueCodes.filter(
  (code): code is TransformConfigIssue['code'] => code !== 'unconnected',
)

// Codes travel in `params`; any other issue means the config does not even have the Draft's
// shape, which must never pass as valid.
function configIssueCode(issue: z.core.$ZodIssue): TransformConfigIssue['code'] {
  const code: unknown = issue.code === 'custom' ? issue.params?.issue : undefined

  return configIssueCodes.find((known) => known === code) ?? 'invalid'
}

export function transformConfigIssues(transform: {
  kind: TransformKind
  config: unknown
}): TransformConfigIssue[] {
  const result = transformConfigSchemas[transform.kind].safeParse(transform.config)

  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        code: configIssueCode(issue),
      }))
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

export function transformPorts(transform: MappingTransform): TransformPorts {
  return specOf(transform.kind).ports(transform.config)
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

export function transformLinkTargets(transformLinks: ReadonlyArray<TransformLink>): string[] {
  return transformLinks.flatMap(({ to }) => (to.kind === 'target' ? [to.path] : []))
}

export function transformIssues({
  transforms,
  transformLinks,
}: {
  transforms: ReadonlyArray<MappingTransform>
  transformLinks: ReadonlyArray<TransformLink>
}): Record<string, TransformIssue[]> {
  const linkedInputs = new Set(
    transformLinks.flatMap(({ to }) =>
      to.kind === 'transform' ? [`${to.transformId}/${to.input}`] : [],
    ),
  )

  return Object.fromEntries(
    transforms.map((transform) => {
      const optional = specOf(transform.kind).optionalInputs ?? []

      const unconnected = transformPorts(transform)
        .inputs.filter(
          (input) => !optional.includes(input) && !linkedInputs.has(`${transform.id}/${input}`),
        )
        .map((input): TransformInputIssue => ({ input, code: 'unconnected' }))

      return [transform.id, [...transformConfigIssues(transform), ...unconnected]]
    }),
  )
}
