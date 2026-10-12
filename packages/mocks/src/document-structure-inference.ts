import { z } from 'zod'

import {
  arrayBasePath,
  arrayPath,
  type CharacterEncoding,
  childPath,
  csvRowsName,
  csvRowsPath,
  type CsvSettings,
  type DocumentField,
  type DocumentFieldType,
  type DocumentStructure,
  type DocumentStructureNode,
  type DocumentStructureSample,
  documentStructureNodes,
  type DocumentStructureProblem,
  type DocumentStructureProblemCode,
  documentStructureSchema,
  type DocumentStructureOrigin,
  type FieldLabelChoice,
  type InferredDocumentStructure,
  inferredDocumentStructureSchema,
  jsonItemsName,
  jsonItemsPath,
  type JsonRoot,
  nodeContent,
  type UpdateDocumentStructureBody,
} from '@edi-bridge/contracts'

import { type PlainName, plainNameOf } from './field-label'

export class DocumentStructureProblemError extends Error {
  constructor(readonly problem: DocumentStructureProblem) {
    super(problem.message)
    this.name = 'DocumentStructureProblemError'
  }
}

function fail(
  code: DocumentStructureProblemCode,
  message: string,
  { path = null, line = null }: { path?: string | null; line?: number | null } = {},
): never {
  throw new DocumentStructureProblemError({ code, message, path, line, mappingVersions: null })
}

export function encodeBase64(bytes: Uint8Array) {
  let binary = ''

  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }

  return btoa(binary)
}

export function decodeBase64(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export function decodeText(base64: string, encoding: CharacterEncoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(decodeBase64(base64))
  } catch {
    return fail(
      'unreadableContent',
      encoding === 'utf-8'
        ? 'The Document is not valid UTF-8. Older ERP exports often use Windows-1252.'
        : `The Document cannot be read as ${encoding}`,
    )
  }
}

const isoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function stringType(value: string): DocumentFieldType {
  return isoDate.test(value) ? 'date' : 'string'
}

function mergeTypes(a: DocumentFieldType, b: DocumentFieldType): DocumentFieldType {
  if (a === b) {
    return a
  }

  const numeric = new Set<DocumentFieldType>(['integer', 'number'])

  return numeric.has(a) && numeric.has(b) ? 'number' : 'string'
}

function listInList(
  code: 'unsupportedJson' | 'unsupportedJsonSchema',
  path: string,
  itemsPath: string,
): never {
  return fail(code, `Lists inside lists are not supported (${itemsPath})`, { path })
}

function checkName(name: string, path: string, code: 'unsupportedJson' | 'unsupportedJsonSchema') {
  if (name.trim() === '' || /[.[\]]/.test(name)) {
    fail(code, `The name "${name}" is empty or contains ".", "[" or "]"`, { path })
  }
}

type JsonValue =
  | { kind: 'null' }
  | { kind: 'value'; type: DocumentFieldType }
  | { kind: 'list'; items: JsonValue[] }
  | { kind: 'record'; entries: Array<[string, JsonValue]> }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null().transform((): JsonValue => ({ kind: 'null' })),
    z.boolean().transform((): JsonValue => ({ kind: 'value', type: 'boolean' })),
    z.number().transform((value): JsonValue => ({
      kind: 'value',
      type: Number.isInteger(value) ? 'integer' : 'number',
    })),
    z.string().transform((value): JsonValue => ({ kind: 'value', type: stringType(value) })),
    z.array(jsonValueSchema).transform((items): JsonValue => ({ kind: 'list', items })),
    z
      .record(z.string(), jsonValueSchema)
      .transform((record): JsonValue => ({ kind: 'record', entries: Object.entries(record) })),
  ]),
)

function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

type Observed =
  | { kind: 'null' }
  | { kind: 'field'; type: DocumentFieldType; optional: boolean }
  | { kind: 'object'; children: Map<string, Observed>; optional: boolean }
  | { kind: 'array'; items: Observed | undefined; optional: boolean }

function optional(observed: Observed): Observed {
  return observed.kind === 'null' ? observed : { ...observed, optional: true }
}

function merge(a: Observed, b: Observed, path: string): Observed {
  if (a.kind === 'null') {
    return optional(b)
  }

  if (b.kind === 'null') {
    return optional(a)
  }

  const optionalEither = a.optional || b.optional

  if (a.kind === 'field' && b.kind === 'field') {
    return { kind: 'field', type: mergeTypes(a.type, b.type), optional: optionalEither }
  }

  if (a.kind === 'object' && b.kind === 'object') {
    const children = new Map<string, Observed>()

    for (const name of new Set([...a.children.keys(), ...b.children.keys()])) {
      const left = a.children.get(name)
      const right = b.children.get(name)

      children.set(
        name,
        left && right ? merge(left, right, childPath(path, name)) : optional((left ?? right)!),
      )
    }

    return { kind: 'object', children, optional: optionalEither }
  }

  if (a.kind === 'array' && b.kind === 'array') {
    const items =
      a.items && b.items ? merge(a.items, b.items, arrayPath(path)) : (a.items ?? b.items)

    return { kind: 'array', items, optional: optionalEither }
  }

  return fail(
    'unsupportedJson',
    `The values at ${path} are sometimes ${a.kind}s, sometimes ${b.kind}s`,
    { path },
  )
}

function observe(value: JsonValue, path: string): Observed {
  switch (value.kind) {
    case 'null':
      return value
    case 'value':
      return { kind: 'field', type: value.type, optional: false }
    case 'list': {
      const itemPath = arrayPath(path)

      const items = value.items.reduce<Observed | undefined>((merged, item) => {
        if (item.kind === 'list') {
          listInList('unsupportedJson', path, itemPath)
        }

        const observed = observe(item, itemPath)

        return merged ? merge(merged, observed, itemPath) : observed
      }, undefined)

      return { kind: 'array', items, optional: false }
    }

    case 'record': {
      const children = new Map<string, Observed>()

      for (const [name, child] of value.entries) {
        const nested = childPath(path, name)
        checkName(name, nested, 'unsupportedJson')
        children.set(name, observe(child, nested))
      }

      return { kind: 'object', children, optional: false }
    }
  }
}

function observedNodes(
  children: Map<string, Observed>,
  parentPath: string,
): DocumentStructureNode[] {
  return [...children].map(([name, observed]) =>
    observedNode(name, observed, childPath(parentPath, name)),
  )
}

function observedNode(name: string, observed: Observed, path: string): DocumentStructureNode {
  const named = { path, name, ...plainNameOf(name) }

  switch (observed.kind) {
    case 'null':
      return { kind: 'field', ...named, type: 'string', required: false }
    case 'field':
      return { kind: 'field', ...named, type: observed.type, required: !observed.optional }
    case 'object':
      return {
        kind: 'object',
        ...named,
        required: !observed.optional,
        children: observedNodes(observed.children, path),
      }
    case 'array': {
      const itemsPath = arrayPath(path)
      const items = observedNode(name, observed.items ?? { kind: 'null' }, itemsPath)

      if (items.kind === 'array') {
        return listInList('unsupportedJson', path, itemsPath)
      }

      return {
        kind: 'array',
        ...named,
        path: itemsPath,
        required: !observed.optional,
        items: { ...items, required: true },
      }
    }
  }
}

export function documentStructureLeaves(
  documentStructure: Pick<DocumentStructure, 'children'>,
): DocumentField[] {
  return [...documentStructureNodes(documentStructure.children)].flatMap(({ node }) => {
    const content = nodeContent(node)

    return content.kind === 'field' ? [content] : []
  })
}

function inferredJson(
  root: 'object' | 'array',
  children: DocumentStructureNode[],
): InferredDocumentStructure {
  return inferredDocumentStructureSchema.parse({
    format: 'json',
    root,
    facts: { fieldCount: documentStructureLeaves({ children }).length },
    sample: null,
    children,
  })
}

export function inferFromJson(text: string): InferredDocumentStructure {
  const parsed = parseJson(text)

  if ('error' in parsed) {
    return fail('invalidJson', `The Document is not valid JSON: ${parsed.error}`)
  }

  const value = jsonValueSchema.parse(parsed.value)

  if (value.kind === 'list') {
    const observed = observe(value, jsonItemsName)

    if (observed.kind !== 'array' || observed.items === undefined) {
      return fail('emptyDocument', 'The Document is an empty list')
    }

    return inferredJson('array', [
      { ...observedNode(jsonItemsName, observed, jsonItemsName), required: true },
    ])
  }

  const observed = observe(value, '')

  if (observed.kind !== 'object') {
    return fail('unsupportedJson', 'The Document must be a JSON object or list at the top level')
  }

  if (observed.children.size === 0) {
    return fail('emptyDocument', 'The Document has no fields')
  }

  return inferredJson('object', observedNodes(observed.children, ''))
}

type CsvRow = { line: number; cells: string[] }

export function parseCsv(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let rowLine = 1

  const endCell = () => {
    cells.push(cell)
    cell = ''
  }

  const endRow = () => {
    endCell()

    if (cells.length > 1 || cells[0] !== '') {
      rows.push({ line: rowLine, cells })
    }

    cells = []
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (character === '"') {
        quoted = false
      } else {
        if (character === '\n') {
          line++
        }

        cell += character
      }
    } else if (character === '"' && cell === '') {
      quoted = true
    } else if (character === delimiter) {
      endCell()
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index++
      }

      endRow()
      line++
      rowLine = line
    } else {
      cell += character
    }
  }

  if (quoted) {
    return fail('invalidCsv', 'A quoted cell is never closed', { line: rowLine })
  }

  if (cell !== '' || cells.length > 0) {
    endRow()
  }

  return rows
}

const integer = /^[+-]?(0|[1-9]\d*)$/

const decimal = /^[+-]?(0|[1-9]\d*)[.,]\d+$/

const germanDate = /^\d{2}\.\d{2}\.\d{4}$/

function cellType(value: string): DocumentFieldType {
  if (integer.test(value)) {
    return 'integer'
  }

  if (decimal.test(value)) {
    return 'number'
  }

  if (/^(true|false)$/i.test(value)) {
    return 'boolean'
  }

  return germanDate.test(value) ? 'date' : stringType(value)
}

function columnNames(header: ReadonlyArray<string>) {
  const used = new Set<string>()

  return header.map((cell, index) => {
    const name = cell.trim() || `column${index + 1}`
    const base = name.replaceAll(/[.[\]]/g, '_')
    let segment = base

    for (let suffix = 2; used.has(segment); suffix++) {
      segment = `${base}_${suffix}`
    }

    used.add(segment)

    return { name: segment === base ? name : segment, segment }
  })
}

export function inferFromCsv(text: string, csv: CsvSettings): InferredDocumentStructure {
  const rows = parseCsv(text, csv.delimiter)

  if (rows.length === 0) {
    return fail('emptyDocument', 'The CSV Document has no rows')
  }

  const [first, ...rest] = rows
  const dataRows = csv.headerRow ? rest : rows
  const columnCount = Math.max(...rows.map(({ cells }) => cells.length))

  const header = csv.headerRow
    ? first!.cells
    : Array.from({ length: columnCount }, (_, index) => `column${index + 1}`)

  if (csv.headerRow) {
    const tooLong = dataRows.find(({ cells }) => cells.length > header.length)

    if (tooLong) {
      fail(
        'inconsistentCsvRows',
        `Line ${tooLong.line} has ${tooLong.cells.length} cells, the header row ${header.length}`,
        { line: tooLong.line },
      )
    }
  }

  const fields = columnNames(header).map(({ name, segment }, column): DocumentField => {
    const values = dataRows.map(({ cells }) => cells[column]?.trim() ?? '')
    const filled = values.filter((value) => value !== '')

    return {
      kind: 'field',
      path: childPath(csvRowsPath, segment),
      name,
      ...plainNameOf(name),
      type:
        filled
          .map(cellType)
          .reduce<DocumentFieldType | undefined>(
            (merged, type) => (merged ? mergeTypes(merged, type) : type),
            undefined,
          ) ?? 'string',
      required: filled.length > 0 && filled.length === values.length,
    }
  })

  const rowList = {
    path: csvRowsPath,
    name: csvRowsName,
    ...plainNameOf(csvRowsName),
    required: true,
  }

  return inferredDocumentStructureSchema.parse({
    format: 'csv',
    csv,
    facts: { columnCount: fields.length, rowCount: dataRows.length },
    sample: null,
    children: [
      { kind: 'array', ...rowList, items: { kind: 'object', ...rowList, children: fields } },
    ],
  })
}

const jsonTypeSchema = z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

type JsonType = z.infer<typeof jsonTypeSchema>

const jsonDataSchema = z.json()

type JsonData = z.infer<typeof jsonDataSchema>

type ValueType = Extract<JsonType, 'integer' | 'number' | 'boolean' | 'string'>

function valuesType(values: ReadonlyArray<JsonData>): ValueType {
  if (values.length > 0 && z.array(z.int()).safeParse(values).success) {
    return 'integer'
  }

  if (values.length > 0 && z.array(z.number()).safeParse(values).success) {
    return 'number'
  }

  return values.length > 0 && z.array(z.boolean()).safeParse(values).success ? 'boolean' : 'string'
}

type SchemaObject = {
  $ref?: string | undefined
  type?: JsonType | JsonType[] | undefined
  format?: string | undefined
  properties?: Record<string, SchemaObject> | undefined
  required?: string[] | undefined
  items?: SchemaObject | SchemaObject[] | undefined
  anyOf?: SchemaObject[] | undefined
  oneOf?: SchemaObject[] | undefined
  allOf?: SchemaObject[] | undefined
  enum?: ValueType | undefined
  const?: ValueType | undefined
  $defs?: Record<string, SchemaObject> | undefined
  definitions?: Record<string, SchemaObject> | undefined
}

const schemaObjectSchema: z.ZodType<SchemaObject> = z.lazy(() =>
  z.object({
    $ref: z.string().optional(),
    type: z.union([jsonTypeSchema, z.array(jsonTypeSchema)]).optional(),
    format: z.string().optional(),
    properties: z.record(z.string(), schemaObjectSchema).optional(),
    required: z.array(z.string()).optional(),
    items: z.union([schemaObjectSchema, z.array(schemaObjectSchema)]).optional(),
    anyOf: z.array(schemaObjectSchema).optional(),
    oneOf: z.array(schemaObjectSchema).optional(),
    allOf: z.array(schemaObjectSchema).optional(),
    enum: z.array(jsonDataSchema).transform(valuesType).optional(),
    const: jsonDataSchema.transform((value) => valuesType([value])).optional(),
    $defs: z.record(z.string(), schemaObjectSchema).optional(),
    definitions: z.record(z.string(), schemaObjectSchema).optional(),
  }),
)

const maxSchemaDepth = 32

function invalidSchema(message: string, path: string | null): never {
  return fail('invalidJsonSchema', message, { path })
}

function unsupportedSchema(message: string, path: string | null): never {
  return fail('unsupportedJsonSchema', message, { path })
}

const localReference = /^#\/(\$defs|definitions)\/([^/]+)$/

function referenced(root: SchemaObject, ref: string, path: string): SchemaObject {
  const [, collection, name = ''] = localReference.exec(ref) ?? []

  if (collection === undefined) {
    return unsupportedSchema(`Only references to $defs or definitions are supported (${ref})`, path)
  }

  const target = (collection === '$defs' ? root.$defs : root.definitions)?.[
    decodeURIComponent(name)
  ]

  return target ?? invalidSchema(`The reference ${ref} points nowhere`, path)
}

type Resolved = {
  schema: SchemaObject
  type: Exclude<JsonType, 'null'>
  nullable: boolean
  refs: ReadonlySet<string>
}

function resolve(
  root: SchemaObject,
  schema: SchemaObject,
  path: string,
  refs: ReadonlySet<string>,
): Resolved {
  if (schema.$ref !== undefined) {
    if (refs.has(schema.$ref)) {
      return unsupportedSchema(`Recursive references are not supported (${schema.$ref})`, path)
    }

    return resolve(root, referenced(root, schema.$ref, path), path, new Set([...refs, schema.$ref]))
  }

  const alternatives = schema.anyOf ?? schema.oneOf

  if (alternatives !== undefined) {
    const nonNull = alternatives.filter(({ type }) => type !== 'null')

    if (nonNull.length !== 1) {
      return unsupportedSchema('Alternatives other than "a value or null" are not supported', path)
    }

    const inner = resolve(root, nonNull[0]!, path, refs)

    return { ...inner, nullable: inner.nullable || nonNull.length < alternatives.length }
  }

  if (schema.allOf !== undefined) {
    const parts = [schema, ...schema.allOf.map((part) => resolve(root, part, path, refs).schema)]

    const merged: SchemaObject = {
      type: 'object',
      properties: Object.fromEntries(
        parts.flatMap(({ properties }) => Object.entries(properties ?? {})),
      ),
      required: parts.flatMap(({ required }) => required ?? []),
    }

    return { schema: merged, type: 'object', nullable: false, refs }
  }

  const declared = schema.type ?? impliedType(schema)
  const types = Array.isArray(declared) ? declared : [declared]
  const nonNull = types.filter((type) => type !== 'null')
  const nullable = nonNull.length < types.length

  if (nonNull.length <= 1) {
    return { schema, type: nonNull[0] ?? 'string', nullable, refs }
  }

  if (nonNull.some((type) => type === 'object' || type === 'array')) {
    return unsupportedSchema('A value that is sometimes a list or object is not supported', path)
  }

  return { schema, type: 'string', nullable, refs }
}

function impliedType(schema: SchemaObject): JsonType {
  if (schema.properties !== undefined) {
    return 'object'
  }

  return schema.items === undefined ? (schema.enum ?? schema.const ?? 'string') : 'array'
}

function schemaFieldType(type: JsonType, schema: SchemaObject): DocumentFieldType {
  switch (type) {
    case 'number':
    case 'integer':
    case 'boolean':
      return type
    default:
      return schema.format === 'date' || schema.format === 'date-time' ? 'date' : 'string'
  }
}

function schemaNode(
  root: SchemaObject,
  name: string,
  schema: SchemaObject,
  path: string,
  required: boolean,
  refs: ReadonlySet<string>,
  depth: number,
): DocumentStructureNode {
  if (depth > maxSchemaDepth) {
    return unsupportedSchema(`The JSON Schema nests deeper than ${maxSchemaDepth} levels`, path)
  }

  const resolved = resolve(root, schema, path, refs)
  const isRequired = required && !resolved.nullable
  const named = { path, name, ...plainNameOf(name) }

  switch (resolved.type) {
    case 'object':
      return {
        kind: 'object',
        ...named,
        required: isRequired,
        children: schemaChildren(root, resolved.schema, path, resolved.refs, depth + 1),
      }
    case 'array': {
      const itemsPath = arrayPath(path)
      const items = resolved.schema.items ?? {}

      if (Array.isArray(items)) {
        return unsupportedSchema('Tuples are not supported', path)
      }

      const itemNode = schemaNode(root, name, items, itemsPath, true, resolved.refs, depth + 1)

      if (itemNode.kind === 'array') {
        return listInList('unsupportedJsonSchema', path, itemsPath)
      }

      return { kind: 'array', ...named, path: itemsPath, required: isRequired, items: itemNode }
    }

    default:
      return {
        kind: 'field',
        ...named,
        type: schemaFieldType(resolved.type, resolved.schema),
        required: isRequired,
      }
  }
}

function schemaChildren(
  root: SchemaObject,
  schema: SchemaObject,
  parentPath: string,
  refs: ReadonlySet<string>,
  depth: number,
): DocumentStructureNode[] {
  const { properties = {}, required = [] } = schema

  return Object.entries(properties).map(([name, property]) => {
    const path = childPath(parentPath, name)
    checkName(name, path, 'unsupportedJsonSchema')

    return schemaNode(root, name, property, path, required.includes(name), refs, depth)
  })
}

export function inferFromJsonSchema(text: string): InferredDocumentStructure {
  const parsed = parseJson(text)

  if ('error' in parsed) {
    return invalidSchema(`The JSON Schema is not valid JSON: ${parsed.error}`, null)
  }

  const root = schemaObjectSchema.safeParse(parsed.value)

  if (!root.success) {
    const [issue] = root.error.issues

    return invalidSchema(
      `The JSON Schema is invalid: ${issue?.message ?? root.error.message}`,
      issue?.path.join('.') || null,
    )
  }

  const resolved = resolve(root.data, root.data, '', new Set())

  if (resolved.type === 'array') {
    const items = schemaNode(root.data, jsonItemsName, root.data, jsonItemsName, true, new Set(), 0)

    return inferredJson('array', [{ ...items, required: true }])
  }

  if (resolved.type !== 'object') {
    return unsupportedSchema(
      'The JSON Schema must describe an object or list at the top level',
      null,
    )
  }

  const children = schemaChildren(root.data, resolved.schema, '', resolved.refs, 0)

  if (children.length === 0) {
    return invalidSchema('The JSON Schema describes no properties', null)
  }

  return inferredJson('object', children)
}

function withSample(
  inferred: InferredDocumentStructure,
  sample: DocumentStructureSample,
): InferredDocumentStructure {
  return { ...inferred, sample }
}

export function inferDocumentStructure(
  origin: DocumentStructureOrigin,
  { takenAt = new Date().toISOString() }: { takenAt?: string } = {},
): InferredDocumentStructure {
  switch (origin.kind) {
    case 'jsonDocument': {
      const text = decodeText(origin.document.content, 'utf-8')

      return withSample(inferFromJson(text), { fileName: origin.document.fileName, text, takenAt })
    }

    case 'csvDocument': {
      const text = decodeText(origin.document.content, origin.csv.encoding)

      return withSample(inferFromCsv(text, origin.csv), {
        fileName: origin.document.fileName,
        text,
        takenAt,
      })
    }

    case 'jsonSchema':
      return inferFromJsonSchema(decodeText(origin.jsonSchema.content, 'utf-8'))
  }
}

export const renamedLabelReason = 'Named by hand.'

function plainNameOfNode({ label, labelReason, labelUnsure }: PlainName): PlainName {
  return { label, labelReason, labelUnsure }
}

function chosenName(current: PlainName, label: string): PlainName {
  return label === current.label
    ? { label, labelReason: current.labelReason, labelUnsure: false }
    : { label, labelReason: renamedLabelReason, labelUnsure: false }
}

function renamedNodes(
  nodes: ReadonlyArray<DocumentStructureNode>,
  nameAt: (node: DocumentStructureNode) => PlainName | undefined,
): DocumentStructureNode[] {
  return nodes.map((node): DocumentStructureNode => {
    const plainName = nameAt(node) ?? plainNameOfNode(node)

    switch (node.kind) {
      case 'field':
        return { ...node, ...plainName }
      case 'object':
        return { ...node, ...plainName, children: renamedNodes(node.children, nameAt) }
      case 'array': {
        const items =
          node.items.kind === 'object'
            ? { ...node.items, ...plainName, children: renamedNodes(node.items.children, nameAt) }
            : { ...node.items, ...plainName }

        return { ...node, ...plainName, items }
      }
    }
  })
}

export function applyLabels<Tree extends { children: DocumentStructureNode[] }>(
  tree: Tree,
  labels: ReadonlyArray<FieldLabelChoice>,
): Tree {
  const byPath = new Map(labels.map(({ path, label }) => [path, label]))

  for (const { path } of labels) {
    if (!findNode(tree.children, path)) {
      fail('unknownPath', `The Document Structure has no node at ${path}`, { path })
    }
  }

  return {
    ...tree,
    children: renamedNodes(tree.children, (node) => {
      const label = byPath.get(node.path)

      return label === undefined ? undefined : chosenName(node, label)
    }),
  }
}

function segmentOf(node: DocumentStructureNode, parentPath: string) {
  const own = arrayBasePath(node.path)

  return parentPath === '' ? own : own.slice(parentPath.length + 1)
}

export function visitedNode(nodes: ReadonlyArray<DocumentStructureNode>, path: string) {
  for (const visited of documentStructureNodes(nodes)) {
    if (visited.node.path === path) {
      return visited
    }
  }

  return undefined
}

export function findNode(nodes: ReadonlyArray<DocumentStructureNode>, path: string) {
  return visitedNode(nodes, path)?.node
}

export function rootListPath(structure: { format: 'csv' } | { format: 'json'; root: JsonRoot }) {
  if (structure.format === 'csv') {
    return csvRowsPath
  }

  return structure.root === 'array' ? jsonItemsPath : undefined
}

export function sameCsvSettings(a: CsvSettings, b: CsvSettings) {
  return a.delimiter === b.delimiter && a.headerRow === b.headerRow && a.encoding === b.encoding
}

function treeOf(
  structure: DocumentStructure,
  { csv, document }: UpdateDocumentStructureBody,
): DocumentStructure {
  if (structure.format === 'json') {
    if (csv || document) {
      fail('notAdjustable', 'Only a CSV Document Structure has CSV settings and a CSV Document')
    }

    return structure
  }

  const settings = csv ?? structure.csv

  if (document) {
    const text = decodeText(document.content, settings.encoding)
    const read = inferFromCsv(text, settings)

    return documentStructureSchema.parse({
      ...read,
      id: structure.id,
      name: structure.name,
      sample: { fileName: document.fileName, text, takenAt: new Date().toISOString() },
      children: renamedNodes(read.children, (node) => {
        const previous = findNode(structure.children, node.path)

        return previous && plainNameOfNode(previous)
      }),
    })
  }

  if (!sameCsvSettings(settings, structure.csv)) {
    fail(
      'csvDocumentRequired',
      'Changing the CSV settings needs a CSV Document, which is read again with the new settings',
    )
  }

  return structure
}

export function adjustDocumentStructure(
  structure: DocumentStructure,
  body: UpdateDocumentStructureBody,
): DocumentStructure {
  const tree = treeOf(structure, body)
  const listPath = rootListPath(tree)
  const pending = new Map(body.adjustments.map((adjustment) => [adjustment.path, adjustment]))

  for (const adjustment of body.adjustments) {
    if (adjustment.path === listPath) {
      fail('notAdjustable', `The ${listPath} list of the Document always repeats`, {
        path: adjustment.path,
      })
    }

    if (tree.format === 'csv' && adjustment.repeating) {
      fail('notAdjustable', 'The columns of a CSV Document never nest or repeat', {
        path: adjustment.path,
      })
    }
  }

  const adjustNodes = (
    nodes: ReadonlyArray<DocumentStructureNode>,
    oldParent: string,
    newParent: string,
  ): DocumentStructureNode[] =>
    nodes.map((node) => {
      const adjustment = pending.get(node.path)
      pending.delete(node.path)

      const inner = nodeContent(node)
      const repeating = adjustment?.repeating ?? node.kind === 'array'
      const required = adjustment?.required ?? node.required
      const ownPath = childPath(newParent, segmentOf(node, oldParent))
      const path = repeating ? arrayPath(ownPath) : ownPath

      if (adjustment?.type && inner.kind !== 'field') {
        fail('notAdjustable', `${node.path} is not a field, so it has no type`, {
          path: node.path,
        })
      }

      const named = {
        name: node.name,
        path,
        ...(adjustment?.label === undefined
          ? plainNameOfNode(node)
          : chosenName(node, adjustment.label)),
      }

      const content: DocumentStructureNode =
        inner.kind === 'field'
          ? { ...inner, ...named, type: adjustment?.type ?? inner.type }
          : { ...inner, ...named, children: adjustNodes(inner.children, node.path, path) }

      return repeating
        ? { kind: 'array', ...named, required, items: { ...content, required: true } }
        : { ...content, required }
    })

  const children = adjustNodes(tree.children, '', '')
  const [unknown] = pending.keys()

  if (unknown !== undefined) {
    fail('unknownPath', `The Document Structure has no node at ${unknown}`, { path: unknown })
  }

  return { ...structure, ...tree, name: body.name, children }
}
