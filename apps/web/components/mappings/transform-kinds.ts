import {
  concatenateInputs,
  type TransformConfig,
  type TransformKind,
  transformKinds,
} from '@edi-bridge/contracts'

export type FieldInput = 'text' | 'integer' | 'optionalInteger' | 'decimalSeparator'

type Field = { readonly input?: FieldInput; readonly ranged?: true }

type FormField = Field & { readonly input: FieldInput }

// A kind with `defaults` can be placed and gets a settings form, so each of its fields needs an
// input; a kind without them still names its fields in the problems shown on its node.
type KindFields<Kind extends TransformKind> =
  | {
      readonly fields: { readonly [Name in keyof TransformConfig<Kind>]: FormField }
      readonly defaults: TransformConfig<Kind>
    }
  | { readonly fields: { readonly [Name in keyof TransformConfig<Kind>]: Field } }

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
  lookupTable: { fields: { lookupTableId: {}, fallback: {} } },
  conditional: { fields: { operator: {}, compareTo: {} } },
  loop: { fields: { counterStart: { ranged: true } } },
  jsonata: { fields: { expression: {} } },
} as const satisfies { [Kind in TransformKind]: KindFields<Kind> }

type Catalogue = typeof transformKindFields

export type PlaceableKind = {
  [Kind in TransformKind]: Catalogue[Kind] extends { defaults: object } ? Kind : never
}[TransformKind]

export function isPlaceable(kind: TransformKind): kind is PlaceableKind {
  return 'defaults' in transformKindFields[kind]
}

export const placeableKinds: ReadonlyArray<PlaceableKind> = transformKinds.filter(isPlaceable)

export function defaultConfig<Kind extends PlaceableKind>(kind: Kind): Catalogue[Kind]['defaults'] {
  return transformKindFields[kind].defaults
}

export type FormFieldSpec = { name: string; input: FieldInput }

export function formFields(kind: PlaceableKind): ReadonlyArray<FormFieldSpec> {
  const fields: Readonly<Record<string, FormField>> = transformKindFields[kind].fields

  return Object.entries(fields).map(([name, { input }]) => ({ name, input }))
}

function fieldOf(kind: TransformKind, name: string): Field | undefined {
  const fields: Readonly<Record<string, Field>> = transformKindFields[kind].fields

  return Object.hasOwn(fields, name) ? fields[name] : undefined
}

export function isField(kind: TransformKind, name: string) {
  return fieldOf(kind, name) !== undefined
}

export function isRanged(kind: TransformKind, name: string) {
  return fieldOf(kind, name)?.ranged === true
}
