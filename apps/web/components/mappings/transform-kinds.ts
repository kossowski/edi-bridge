import {
  concatenateInputs,
  operatorsWithOperand,
  type TransformConfig,
  type TransformKind,
} from '@edi-bridge/contracts'

import type { CanvasIssue } from '@/components/mappings/mapping-graph'

export type FieldInput =
  | 'text'
  | 'integer'
  | 'optionalInteger'
  | 'decimalSeparator'
  | 'lookupTable'
  | 'fallback'
  | 'operator'
  | 'expression'

export type FormValues = Readonly<Record<string, string>>

type CanvasOnlyCode = Extract<CanvasIssue, { code: 'unknownLookupTable' }>['code']

type FormField = {
  readonly input: FieldInput
  readonly ranged?: true
  readonly visibleWhen?: (values: FormValues) => boolean
  // Problems only the canvas can know, shown beside the field until its value changes.
  readonly canvasIssues?: ReadonlyArray<CanvasOnlyCode>
}

type KindFields<Kind extends TransformKind> = {
  readonly fields: { readonly [Name in keyof TransformConfig<Kind>]: FormField }
  readonly defaults: TransformConfig<Kind>
}

// The messages follow these names: `fields.<kind>.<field>` labels a field,
// `fieldDescriptions.<kind>.<field>` describes it in the form and `ranges.<kind>.<field>` says
// what a `ranged` field allows. The fields show in the order they are listed.
export const transformKindFields = {
  constant: {
    fields: { value: { input: 'text' } },
    defaults: { value: '' },
  },
  concatenate: {
    fields: { inputCount: { input: 'integer', ranged: true }, separator: { input: 'text' } },
    defaults: { inputCount: concatenateInputs.min, separator: '' },
  },
  split: {
    fields: { separator: { input: 'text' }, index: { input: 'integer', ranged: true } },
    defaults: { separator: '', index: 0 },
  },
  substring: {
    fields: {
      start: { input: 'integer', ranged: true },
      length: { input: 'optionalInteger', ranged: true },
    },
    defaults: { start: 0, length: null },
  },
  dateFormat: {
    fields: { from: { input: 'text' }, to: { input: 'text' } },
    defaults: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
  },
  numberFormat: {
    fields: {
      decimalPlaces: { input: 'optionalInteger', ranged: true },
      decimalSeparator: { input: 'decimalSeparator' },
    },
    defaults: { decimalPlaces: 2, decimalSeparator: '.' },
  },
  lookupTable: {
    fields: {
      // A deleted Lookup Table is only known on the canvas; it stays a problem until another is
      // chosen.
      lookupTableId: { input: 'lookupTable', canvasIssues: ['unknownLookupTable'] },
      fallback: { input: 'fallback' },
    },
    defaults: { lookupTableId: null, fallback: 'keepValue' },
  },
  conditional: {
    fields: {
      operator: { input: 'operator' },
      compareTo: {
        input: 'text',
        visibleWhen: ({ operator }) => operatorsWithOperand.some((found) => found === operator),
      },
    },
    defaults: { operator: 'equals', compareTo: '' },
  },
  loop: {
    fields: { counterStart: { input: 'integer', ranged: true } },
    defaults: { counterStart: 1 },
  },
  jsonata: {
    fields: { expression: { input: 'expression' } },
    defaults: { expression: '' },
  },
} as const satisfies { [Kind in TransformKind]: KindFields<Kind> }

type Catalogue = typeof transformKindFields

export function defaultConfig<Kind extends TransformKind>(kind: Kind): Catalogue[Kind]['defaults'] {
  return transformKindFields[kind].defaults
}

export type FormFieldSpec = FormField & { name: string }

export function formFields(kind: TransformKind): ReadonlyArray<FormFieldSpec> {
  const fields: Readonly<Record<string, FormField>> = transformKindFields[kind].fields

  return Object.entries(fields).map(([name, field]) => ({ ...field, name }))
}

function fieldOf(kind: TransformKind, name: string): FormField | undefined {
  const fields: Readonly<Record<string, FormField>> = transformKindFields[kind].fields

  return Object.hasOwn(fields, name) ? fields[name] : undefined
}

export function isField(kind: TransformKind, name: string) {
  return fieldOf(kind, name) !== undefined
}

export function isRanged(kind: TransformKind, name: string) {
  return fieldOf(kind, name)?.ranged === true
}
